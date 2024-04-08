FROM node:17 AS node_base

WORKDIR /app/db-schema
COPY ./db-schema /app/db-schema
RUN npm install
RUN npm i sqlite3 -D && rm -rf node_modules && npm i && npm rebuild

COPY ./contracts/protocols/ /app/contracts/protocols/
COPY ./contracts/builds/ /app/contracts/builds/
COPY ./const.js /app/


FROM node_base

WORKDIR /app/stats-backend
COPY ./stats-backend/package.json /app/stats-backend/package.json
RUN npm install

COPY ./stats-backend/index.js /app/stats-backend/index.js


CMD ["node", "index.js"]
