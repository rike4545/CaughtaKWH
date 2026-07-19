# Pricing Neural Model

Generated: 2026-07-19T10:13:18.535Z

- Status: **experimental**
- Reason: Holdout quality passed; more stations and price history are needed before blending.
- Examples: 75
- Stations: 1
- Distinct prices: 3
- Half-hour slots: 19
- Utilization coverage: 0%
- Holdout MAE: $0.0442/kWh
- Baseline MAE: $0.0493/kWh
- Capture validation: enabled
- Price blending: disabled
- Historical official captures checked: 36
- Captures flagged for review: 1

The network never creates an official observation. It scores captured prices and supplies an experimental estimate only after holdout checks pass.
