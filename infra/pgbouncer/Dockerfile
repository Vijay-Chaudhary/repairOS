FROM alpine:3.20
RUN apk add --no-cache pgbouncer postgresql-client \
 && adduser -D -H -S pgbouncer
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
USER pgbouncer
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
