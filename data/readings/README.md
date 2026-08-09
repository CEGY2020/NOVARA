# Readings import files

Copy your export into this folder from your machine:

```bash
cp ~/Desktop/YOUR_FILE.csv data/readings/
```

Then import into DynamoDB `NOVARAReadings`:

```bash
python3 scripts/import_readings.py data/readings/YOUR_FILE.csv --dry-run
python3 scripts/import_readings.py data/readings/YOUR_FILE.csv --execute
```

Excel (`.xlsx`) also works if you install `openpyxl`. See the [Importing readings](../../README.md#importing-readings-into-novarareadings) section in the main README for the exact column format.
