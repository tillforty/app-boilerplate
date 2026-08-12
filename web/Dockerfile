# Tillforty web — build the Vite app, then serve the static bundle with nginx.
# Stage 1: build
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Sentry/GlitchTip config for the browser SDK. Vite inlines VITE_* from the
# build environment into the static bundle, so these must be present at BUILD
# time (passed as build args from docker-compose). Blank = SDK no-ops.
ARG VITE_SENTRY_DSN=""
ARG VITE_SENTRY_ENVIRONMENT="production"
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN \
    VITE_SENTRY_ENVIRONMENT=$VITE_SENTRY_ENVIRONMENT
RUN npm run build

# Stage 2: serve
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
