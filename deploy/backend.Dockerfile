FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV HUSKY=0 YARN_ENABLE_SCRIPTS=false
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
COPY server/package.json ./server/package.json
COPY packages/schema/package.json ./packages/schema/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json
COPY packages/nextjs/package.json ./packages/nextjs/package.json
COPY packages/foundry/package.json ./packages/foundry/package.json
RUN node .yarn/releases/yarn-3.2.3.cjs plugin import workspace-tools \
    && node .yarn/releases/yarn-3.2.3.cjs workspaces focus @9oob/server @9oob/schema
COPY tsconfig.base.json ./
COPY server ./server
COPY packages/schema ./packages/schema
RUN node .yarn/releases/yarn-3.2.3.cjs workspace @9oob/schema build \
    && node .yarn/releases/yarn-3.2.3.cjs workspace @9oob/server build \
    && node .yarn/releases/yarn-3.2.3.cjs workspaces focus @9oob/server @9oob/schema --production \
    && mkdir -p node_modules packages/schema/node_modules

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NOOB_SERVER_HOST=0.0.0.0 NOOB_SERVER_PORT=3001
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/packages/schema/package.json ./packages/schema/package.json
COPY --from=build /app/packages/schema/node_modules ./packages/schema/node_modules
COPY --from=build /app/packages/schema/dist ./packages/schema/dist
USER node
WORKDIR /app/server
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3001/health').then(async r=>{if(!r.ok||!(await r.json()).configured)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
