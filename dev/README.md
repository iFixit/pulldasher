# directory `dev`

This directory contains tools used for developing pulldasher

## `dump-schema-from-compose`

Dump the schema of the running docker-compose db service.

Example usage:
```
cd <project root>
ENV_FILE=.env SCHEMA_FILE=migrations/schema.sql dev/dump-schema-from-compose
```

## `log-in-to-db`

Log into the running docker-compose db service.

Example usage:

```
cd <project root>
ENV_FILE=.env dev/log-in-to-db
```
