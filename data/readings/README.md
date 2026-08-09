# Readings import files

Put CSV (or Excel `.xlsx`) exports here, then import into DynamoDB `NOVARAReadings`:

```bash
# Site-level (legacy / mixed)
python3 scripts/import_readings.py data/readings/your_file.csv --dry-run
python3 scripts/import_readings.py data/readings/your_file.csv --execute

# Per-system (CSV can be TimestampUTC,T1,T2,RelayState)
python3 scripts/import_readings.py data/readings/your_file.csv --execute \
  --site-id SITE001 --system-id SYS001
```

See the [Importing readings](../../README.md#importing-readings-into-novarareadings) section in the main README for the exact column format.
