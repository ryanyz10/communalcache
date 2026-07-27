# syntax=docker/dockerfile:1

FROM node:20-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json* ./
RUN npm ci || npm install
COPY web/ ./
RUN npm run build

FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
COPY --from=web /src/web/dist ./cmd/server/dist
RUN CGO_ENABLED=0 go build -o /communalcache ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /communalcache /communalcache
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/communalcache"]
