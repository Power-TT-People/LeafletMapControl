# LeafletMapControl

A Power Apps Component Framework (PCF) control that renders an interactive Leaflet map from a Dataverse dataset. Markers are placed using latitude/longitude fields on each record, with a fallback to address geocoding via the OpenStreetMap Nominatim API.

---

## Features

- Interactive map powered by [Leaflet](https://leafletjs.com/) and [OpenStreetMap](https://www.openstreetmap.org/)
- Plots markers from any Dataverse dataset view
- Configurable field mappings for coordinates, titles, and descriptions
- Geocoding fallback when lat/lng fields are not populated
- Geocoding cache to minimize API calls
- Marker popups with a direct link to open the full Dataverse record
- Auto-fits map bounds to all visible markers

---

## External Dependencies

| Service | Purpose |
|---|---|
| [unpkg.com](https://unpkg.com) | CDN for Leaflet JS/CSS |
| [tile.openstreetmap.org](https://tile.openstreetmap.org) | Map tiles |
| [nominatim.openstreetmap.org](https://nominatim.openstreetmap.org) | Address geocoding |

These URLs must be allowlisted in your Power Platform environment if network restrictions apply.

---

## Configuration Properties

| Property | Type | Description |
|---|---|---|
| `defaultLatitude` | Decimal | Default map center latitude |
| `defaultLongitude` | Decimal | Default map center longitude |
| `defaultZoom` | Whole Number | Default zoom level |
| `latitudeColumn` | Bound column (Text/Decimal/Float) | Preferred dataset-bound latitude column |
| `longitudeColumn` | Bound column (Text/Decimal/Float) | Preferred dataset-bound longitude column |
| `latitudeField` | SingleLine.Text | Dataset field containing latitude |
| `longitudeField` | SingleLine.Text | Dataset field containing longitude |
| `titleField` | SingleLine.Text | Dataset field for marker popup title |
| `descriptionField` | SingleLine.Text | Dataset field for marker popup description |
| `addressField` | SingleLine.Text | Street address field (geocoding fallback) |
| `cityField` | SingleLine.Text | City field (geocoding fallback) |
| `stateField` | SingleLine.Text | State field (geocoding fallback) |
| `postalCodeField` | SingleLine.Text | Postal code field (geocoding fallback) |
| `countryField` | SingleLine.Text | Country field (geocoding fallback) |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- [Power Platform CLI](https://learn.microsoft.com/en-us/power-platform/developer/cli/introduction)
- [.NET SDK](https://dotnet.microsoft.com/)

### Install & Build

```bash
npm install
npm run build
```

### Run Locally (Test Harness)

```bash
npm start
```

### Package for Deployment

```bash
pac solution init --publisher-name YourPublisher --publisher-prefix yourprefix
pac solution add-reference --path .
dotnet build
```

---

## Project Structure

```
LeafletMapControl/
├── LeafletMapControl/
│   ├── index.ts                    # Main PCF control class
│   ├── ControlManifest.Input.xml   # Control manifest and property declarations
│   └── css/
│       └── LeafletMapControl.css   # Marker and popup styles
├── package.json
├── tsconfig.json
└── LeafletMapControl.pcfproj
```

---

## Customization

This repo serves as the base control. Customer-specific implementations are maintained in separate downstream repositories that track this one as `upstream`. To pull base enhancements into a downstream repo:

```bash
git fetch upstream
git merge upstream/master
```

---

## License

MIT
