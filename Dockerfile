FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata
COPY helpdesk /usr/local/bin/helpdesk
EXPOSE 8080
ENTRYPOINT ["helpdesk"]
