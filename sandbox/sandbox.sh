#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
KEY=$(printf '%s' "$ROOT" | cksum | awk '{print $1}')
NAME="phaseweb-web-$KEY"
IMAGE="phaseweb-web:$KEY"
check_owner() {
    owner=$(docker inspect --format '{{index .Config.Labels "phaseweb.workspace"}}' "$NAME")
    [ "$owner" = "$ROOT" ] || { echo 'Container name is already used by another project.' >&2; exit 1; }
}
case "${1:-help}" in
    start)
        [ "$(id -u)" != 0 ] || { echo 'Run as a non-root user.' >&2; exit 1; }
        docker info >/dev/null
        if docker container inspect "$NAME" >/dev/null 2>&1; then
            check_owner
            docker start "$NAME" >/dev/null
        else
            docker build -t "$IMAGE" -f "$ROOT/sandbox/Dockerfile" "$ROOT"
            docker run -d --name "$NAME" --label "phaseweb.workspace=$ROOT" \
                --user "$(id -u):$(id -g)" \
                --mount "type=bind,source=$ROOT,target=/workspace" \
                --read-only --tmpfs /tmp:rw,nosuid,nodev,size=256m \
                --cap-drop ALL --security-opt no-new-privileges:true \
                --network bridge --publish 127.0.0.1:8080:8080 \
                --pids-limit 128 --memory 1g --cpus 2 "$IMAGE" >/dev/null
        fi
        echo 'PhaseWEB : http://127.0.0.1:8080/index.php'
        ;;
    shell)
        check_owner
        docker exec -it "$NAME" sh
        ;;
    test)
        check_owner
        docker exec "$NAME" php -l /workspace/public/index.php
        docker exec "$NAME" php -r '$s=file_get_contents("/proc/self/status"); if (!preg_match("/^Uid:\\s+([1-9][0-9]*)/m", $s) || !str_contains($s,"NoNewPrivs:\t1") || !str_contains($s,"CapEff:\t0000000000000000") || file_exists("/var/run/docker.sock")) {exit(1);} $body=file_get_contents("http://127.0.0.1:8080/index.php"); if (!str_contains($body,"PhaseWEB")) {exit(1);} echo "OK: HTTP, PHP, non-root user, no capabilities, no-new-privileges, no Docker socket.\n";'
        docker inspect --format 'Mounts={{json .Mounts}} Privileged={{.HostConfig.Privileged}} ReadonlyRootfs={{.HostConfig.ReadonlyRootfs}} Ports={{json .HostConfig.PortBindings}}' "$NAME"
        ;;
    stop)
        if docker container inspect "$NAME" >/dev/null 2>&1; then
            check_owner
            docker stop "$NAME" >/dev/null
            docker rm "$NAME" >/dev/null
        fi
        ;;
    *) echo 'Usage: sh sandbox/sandbox.sh {start|shell|test|stop}' ;;
esac
