FROM node:22-alpine AS base

RUN apk add --no-cache dumb-init openssl

WORKDIR /app

ENV NODE_ENV=production

FROM base AS deps

COPY package.json package-lock.json* ./
RUN npm ci

FROM deps AS build

COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runtime

ENV NPM_CONFIG_CACHE=/tmp/.npm

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma

USER node

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "docker-start"]
