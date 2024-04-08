FROM node:17 AS node_base

WORKDIR /app/db-schema
COPY ./db-schema /app/db-schema
RUN npm install
RUN npm i sqlite3 -D && rm -rf node_modules && npm i && npm rebuild

COPY ./contracts/protocols/ /app/contracts/protocols/
COPY ./contracts/builds/ /app/contracts/builds/
COPY ./const.js /app/


FROM node_base

COPY protos /app/protos

WORKDIR /app/telemetry-backend
COPY ./telemetry-backend/package.json /app/telemetry-backend/package.json
RUN npm install

COPY ./telemetry-backend/backend.js /app/telemetry-backend/backend.js

CMD ["node", "backend.js"]
