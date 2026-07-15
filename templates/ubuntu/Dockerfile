ARG BASE_IMAGE=ubuntu:24.04
FROM ${BASE_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    systemd \
    systemd-sysv \
    dbus \
    sudo \
    openssh-server \
    curl \
    ca-certificates \
    iproute2 \
    iputils-ping \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN echo 'root:root' | chpasswd \
    && mkdir -p /etc/ssh/sshd_config.d /var/run/sshd \
    && printf '%s\n' \
        'PermitRootLogin yes' \
        'PasswordAuthentication yes' \
        'UsePAM yes' \
        'AllowTcpForwarding yes' \
        'AllowStreamLocalForwarding yes' \
        > /etc/ssh/sshd_config.d/99-edi-containers.conf \
    && systemctl enable ssh.service \
    && systemctl disable ssh.socket || true

CMD ["/lib/systemd/systemd"]
