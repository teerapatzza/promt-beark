FROM node:20-alpine

# better-sqlite3 ต้องการ tools เพื่อ compile native module
RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

COPY server.js .
COPY validation.js .
COPY microsoft-auth.js .
RUN mkdir -p /app/data

EXPOSE 3000
CMD ["node", "server.js"]
