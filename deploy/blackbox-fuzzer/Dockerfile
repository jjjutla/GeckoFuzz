FROM node:17 AS node_base

WORKDIR /app/db-schema
COPY ./db-schema /app/db-schema
RUN npm install
RUN npm i sqlite3 -D && rm -rf node_modules && npm i && npm rebuild

COPY ./contracts/protocols/ /app/contracts/protocols/
COPY ./contracts/builds/ /app/contracts/builds/
COPY ./const.js /app/

FROM node_base
RUN npm i
RUN npm run build --workspaces


WORKDIR /app/telemetry-backend

COPY telemetry-backend/package.json /app/telemetry-backend/

RUN npm i

COPY telemetry-backend/*_client.js /app/telemetry-backend/


WORKDIR /app/fuzzer

COPY protos /app/protos

COPY ./fuzzer/package.json /app/fuzzer/package.json
COPY ./fuzzer/tsconfig.json /app/fuzzer/tsconfig.json

RUN npm i
RUN npm i typescript -g

COPY ./fuzzer/src /app/fuzzer/src
COPY ./fuzzer/cli.ts /app/fuzzer/cli.ts

RUN tsc


# cleanup
RUN rm -rf *.ts
RUN rm -rf */*.ts
RUN sed -i '/MYSQL/d' ../const.js


ENTRYPOINT ["node", "cli.js"]
