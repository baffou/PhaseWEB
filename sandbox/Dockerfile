FROM php:8.4-cli-alpine
ENV HOME=/tmp
WORKDIR /workspace
USER 1000:1000
EXPOSE 8080
CMD ["php", "-S", "0.0.0.0:8080", "-t", "/workspace/public"]
