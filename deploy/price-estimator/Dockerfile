FROM node:17

COPY const.js /app/const.js

WORKDIR /app/price
COPY price-estimator /app/price
RUN npm install

RUN chmod +x /app/price/node_modules/7zip-bin/linux/arm64/7za
RUN chmod +x /app/price/node_modules/7zip-bin/linux/x64/7za
CMD [ "node", "price.js" ]
