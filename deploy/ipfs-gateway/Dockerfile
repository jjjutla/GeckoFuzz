FROM node:16

WORKDIR /app/gw
COPY ipfs-gateway /app/gw
RUN npm install

CMD [ "node", "ipfs_gateway.js" ]