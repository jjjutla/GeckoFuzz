FROM node:16

WORKDIR /app/frontend
COPY landing /app/frontend
RUN npm install

COPY ./contracts/protocols/ /app/contracts/protocols/
COPY ./contracts/builds/ /app/contracts/builds/
COPY ./const.js /app/const.js

RUN npm run build


EXPOSE 3000

ENV NUXT_HOST=0.0.0.0
ENV NUXT_PORT=3000

CMD [ "npm", "start" ]