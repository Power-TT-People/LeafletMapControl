/// <reference types="powerapps-component-framework" />
import { IInputs, IOutputs } from "./generated/ManifestTypes";

interface LeafletMapInstance {
  remove(): void;
  setView(center: [number, number], zoom: number): void;
  fitBounds(bounds: [number, number][], options?: { padding?: [number, number] }): void;
}

interface LeafletLayerGroup {
  addTo(map: LeafletMapInstance): LeafletLayerGroup;
  clearLayers(): void;
  addLayer(layer: LeafletMarker): void;
}

interface LeafletMarker {
  bindPopup(content: string): void;
  openPopup(): void;
  closePopup(): void;
  on(event: string, callback: () => void): void;
}

interface LeafletGlobal {
  map(container: HTMLElement, options: {
    center: [number, number];
    zoom: number;
    zoomControl: boolean;
    attributionControl: boolean;
  }): LeafletMapInstance;
  tileLayer(urlTemplate: string, options: { attribution: string; maxZoom: number }): { addTo(map: LeafletMapInstance): void };
  layerGroup(): LeafletLayerGroup;
  marker(location: [number, number], options: { icon: unknown }): LeafletMarker;
  divIcon(options: {
    className: string;
    html: string;
    iconSize: [number, number];
    iconAnchor: [number, number];
    popupAnchor: [number, number];
  }): unknown;
}

type ContextWithNavigation = ComponentFramework.Context<IInputs> & {
  navigation?: {
    openForm(input: { entityName: string; entityId: string }): void;
  };
};

// Leaflet is loaded via CDN in the HTML container; declare global
declare const L: LeafletGlobal;

const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS  = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

export class LeafletMapControl
  implements ComponentFramework.StandardControl<IInputs, IOutputs>
{
  private _container: HTMLDivElement;
  private _map: LeafletMapInstance | null;
  private _markersLayer: LeafletLayerGroup | null;
  private _notifyOutputChanged: () => void;
  private _leafletReady = false;
  private _context: ComponentFramework.Context<IInputs>;
  private _renderTimer: number | null = null;
  private _geocodeCache = new Map<string, [number, number] | null>();

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  public init(
    context: ComponentFramework.Context<IInputs>,
    notifyOutputChanged: () => void,
    state: ComponentFramework.Dictionary,
    container: HTMLDivElement
  ): void {
    this._notifyOutputChanged = notifyOutputChanged;
    this._container = container;
    this._container.classList.add("lcm-root");
    this._context = context;
    context.mode.trackContainerResize(true);
  }

  public updateView(context: ComponentFramework.Context<IInputs>): void {
    this._context = context;

    // Dataverse can trigger updateView frequently while loading/resizing; debounce to avoid restarting geocoding.
    if (this._renderTimer !== null) {
      window.clearTimeout(this._renderTimer);
    }

    this._renderTimer = window.setTimeout(() => {
      this._renderTimer = null;
      this._ensureLeaflet(() => this._renderMap(this._context));
    }, 120);
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    if (this._renderTimer !== null) {
      window.clearTimeout(this._renderTimer);
      this._renderTimer = null;
    }

    if (this._map) {
      this._map.remove();
      this._map = null;
    }
  }

  // ─── Leaflet lazy-loader ─────────────────────────────────────────────────

  private _ensureLeaflet(callback: () => void): void {
    if (this._leafletReady && typeof L !== "undefined") {
      callback();
      return;
    }

    // Inject Leaflet CSS once
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id   = "leaflet-css";
      link.rel  = "stylesheet";
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }

    // Inject Leaflet JS once
    if (!document.getElementById("leaflet-js")) {
      const script  = document.createElement("script");
      script.id     = "leaflet-js";
      script.src    = LEAFLET_JS;
      script.onload = () => {
        this._leafletReady = true;
        callback();
      };
      document.head.appendChild(script);
    } else if (typeof L !== "undefined") {
      this._leafletReady = true;
      callback();
    }
  }

  // ─── Map initialisation & update ─────────────────────────────────────────

  private _renderMap(context: ComponentFramework.Context<IInputs>): void {
    const defaultLat  = (context.parameters.defaultLatitude.raw  as number) ?? 39.5;
    const defaultLng  = (context.parameters.defaultLongitude.raw as number) ?? -98.35;
    const defaultZoom = (context.parameters.defaultZoom.raw      as number) ?? 4;

    if (!this._map) {
      this._map = L.map(this._container, {
        center: [defaultLat, defaultLng],
        zoom: defaultZoom,
        zoomControl: true,
        attributionControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(this._map);

      this._markersLayer = L.layerGroup().addTo(this._map);
    }

    void this._updateMarkers(context);
  }

  private async _updateMarkers(context: ComponentFramework.Context<IInputs>): Promise<void> {
    if (!this._markersLayer) return;
    this._markersLayer.clearLayers();

    const dataset = context.parameters.mapDataSet;

    if (
      !dataset ||
      !dataset.sortedRecordIds ||
      dataset.sortedRecordIds.length === 0
    ) return;

    const bounds: [number, number][] = [];
    const targetEntity = dataset.getTargetEntityType?.() || "record";
    const openLabel = `Open ${targetEntity} ↗`;

    // Resolve configured field names, falling back to Account defaults
    const latFields   = this._fieldList(context.parameters.latitudeField.raw,   ["address1_latitude",  "latitude", "lat"]);
    const lngFields   = this._fieldList(context.parameters.longitudeField.raw,  ["address1_longitude", "longitude", "lng"]);
    const titleFields = this._fieldList(context.parameters.titleField.raw,       ["name", "fullname", "subject", "title", "accountnumber"]);
    const descFields  = this._fieldList(context.parameters.descriptionField.raw, ["description", "address1_composite", "address1_line1"]);

    for (const id of dataset.sortedRecordIds) {
      const record = dataset.records[id];

      const lat = this._toNumber(this._getFirstValue(record, latFields));
      const lng = this._toNumber(this._getFirstValue(record, lngFields));
      let resolvedLat = lat;
      let resolvedLng = lng;
      const name = this._toText(this._getFirstValue(record, titleFields), "Record");
      const desc = this._toText(this._getFirstValue(record, descFields));

      if (isNaN(resolvedLat) || isNaN(resolvedLng)) {
        const address = this._buildAddress(record, context);
        if (address) {
          const geocoded = await this._geocodeAddress(address);
          if (geocoded) {
            [resolvedLat, resolvedLng] = geocoded;
          }
        }
      }

      if (isNaN(resolvedLat) || isNaN(resolvedLng)) continue;

      const marker = L.marker([resolvedLat, resolvedLng], { icon: this._defaultIcon() });

      const popupContent = `
        <div class="lcm-popup">
          <strong class="lcm-popup__title">${this._escape(name)}</strong>
          ${desc ? `<p class="lcm-popup__desc">${this._escape(desc)}</p>` : ""}
          <a class="lcm-popup__link" href="#" data-id="${id}">${openLabel}</a>
        </div>`;

      marker.bindPopup(popupContent);

      let _hoverCloseTimer: number | null = null;

      marker.on("mouseover", () => {
        if (_hoverCloseTimer !== null) {
          window.clearTimeout(_hoverCloseTimer);
          _hoverCloseTimer = null;
        }
        marker.openPopup();
      });

      marker.on("mouseout", () => {
        _hoverCloseTimer = window.setTimeout(() => marker.closePopup(), 300);
      });

      marker.on("popupopen", () => {
        // Keep popup open when the mouse moves into it
        const popupWrapper = this._container.querySelector<HTMLElement>(".leaflet-popup");
        if (popupWrapper) {
          popupWrapper.addEventListener("mouseenter", () => {
            if (_hoverCloseTimer !== null) {
              window.clearTimeout(_hoverCloseTimer);
              _hoverCloseTimer = null;
            }
          });
          popupWrapper.addEventListener("mouseleave", () => {
            _hoverCloseTimer = window.setTimeout(() => marker.closePopup(), 300);
          });
        }

        const link = this._container.querySelector<HTMLAnchorElement>(
          `.lcm-popup__link[data-id="${id}"]`
        );
        if (link) {
          link.onclick = (e: MouseEvent) => {
            e.preventDefault();
            (context as ContextWithNavigation).navigation?.openForm({
              entityName: dataset.getTargetEntityType(),
              entityId: id,
            });
          };
        }
      });

      this._markersLayer.addLayer(marker);
      bounds.push([resolvedLat, resolvedLng]);
    }

    if (bounds.length === 1) {
      this._map.setView(bounds[0], 12);
    } else if (bounds.length > 1) {
      this._map.fitBounds(bounds, { padding: [40, 40] });
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private _defaultIcon(): unknown {
    return L.divIcon({
      className: "lcm-marker",
      html: `<span class="lcm-marker__dot"></span>`,
      iconSize:    [28, 28],
      iconAnchor:  [14, 28],
      popupAnchor: [0, -30],
    });
  }

  private _escape(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private _getFirstValue(
    record: ComponentFramework.PropertyHelper.DataSetApi.EntityRecord,
    fields: string[]
  ): unknown {
    for (const field of fields) {
      const value = record.getValue(field);
      if (value !== null && value !== undefined && value !== "") {
        return value;
      }
    }

    return null;
  }

  private _toNumber(value: unknown): number {
    if (typeof value === "number") return value;
    if (typeof value === "string") return parseFloat(value);
    return NaN;
  }

  private _toText(value: unknown, fallback = ""): string {
    if (value === null || value === undefined) return fallback;
    return String(value);
  }

  /** Builds a field lookup list: configured value first, then Account defaults. */
  private _fieldList(configured: string | null, defaults: string[]): string[] {
    const trimmed = configured?.trim();
    return trimmed ? [trimmed, ...defaults] : defaults;
  }

  private _buildAddress(
    record: ComponentFramework.PropertyHelper.DataSetApi.EntityRecord,
    ctx: ComponentFramework.Context<IInputs>
  ): string {
    const composite = this._toText(
      this._getFirstValue(record, ["address1_composite", "address2_composite"])
    ).trim();
    if (composite) {
      return composite;
    }

    const line1Field   = ctx.parameters.addressLine1Field.raw   || "address1_line1";
    const cityField    = ctx.parameters.addressCityField.raw    || "address1_city";
    const stateField   = ctx.parameters.addressStateField.raw   || "address1_stateorprovince";
    const postalField  = ctx.parameters.addressPostalCodeField.raw || "address1_postalcode";
    const countryField = ctx.parameters.addressCountryField.raw || "address1_country";

    const parts = [
      this._toText(this._getFirstValue(record, [line1Field])).trim(),
      this._toText(this._getFirstValue(record, [cityField])).trim(),
      this._toText(this._getFirstValue(record, [stateField])).trim(),
      this._toText(this._getFirstValue(record, [postalField])).trim(),
      this._toText(this._getFirstValue(record, [countryField])).trim(),
    ].filter((part) => part.length > 0);

    return parts.join(", ");
  }

  private async _geocodeAddress(address: string): Promise<[number, number] | null> {
    if (this._geocodeCache.has(address)) {
      return this._geocodeCache.get(address) ?? null;
    }

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        this._geocodeCache.set(address, null);
        return null;
      }

      const payload = (await response.json()) as { lat: string; lon: string }[];
      const first = payload[0];
      if (!first) {
        this._geocodeCache.set(address, null);
        return null;
      }

      const lat = parseFloat(first.lat);
      const lng = parseFloat(first.lon);
      if (isNaN(lat) || isNaN(lng)) {
        this._geocodeCache.set(address, null);
        return null;
      }

      const result: [number, number] = [lat, lng];
      this._geocodeCache.set(address, result);
      return result;
    } catch {
      this._geocodeCache.set(address, null);
      return null;
    }
  }
}