#!/bin/sh
# Entrypoint for docker-compose service

# Wait for the DB to start accepting connections.
for i in $(seq 5); do
   echo "Attempt $i"
   node migrate.js && break || sleep 10
done

echo "Setup done, starting pulldasher..."
# Start pulldasher
node bin/pulldasher
