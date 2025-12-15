# ---- Build stage ----
FROM node:20-bullseye AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY templates ./templates
RUN npm run build

# ---- Runtime stage ----
FROM node:20-bullseye
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=build /app/dist ./dist
COPY templates ./templates
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
