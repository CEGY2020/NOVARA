# Readings import files

Put CSV (or Excel `.xlsx`) exports here, then import into DynamoDB `NOVARAReadings`:

```bash
python3 scripts/import_readings.py data/readings/your_file.csv --dry-run
python3 scripts/import_readings.py data/readings/your_file.csv --execute
```

See the [Importing readings](../../README.md#importing-readings-into-novarareadings) section in the main README for the exact column format.
