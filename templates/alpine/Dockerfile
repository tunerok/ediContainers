ARG BASE_IMAGE=alpine:3.21
FROM ${BASE_IMAGE}

# Apple machines boot /sbin/init (BusyBox → OpenRC). Do NOT enable OpenRC
# "networking": it runs udhcpc, fails, and wipes the address vminitd already set.
RUN apk add --no-cache \
    openrc \
    openssh \
    bash \
    sudo \
    curl \
    ca-certificates \
    iproute2 \
    iputils \
    libstdc++ \
    nodejs \
    npm \
    && mkdir -p /run/openrc /var/run/sshd /etc/ssh/sshd_config.d \
    && touch /run/openrc/softlevel \
    && echo 'root:root' | chpasswd \
    && ssh-keygen -A \
    && printf '%s\n' \
        'PermitRootLogin yes' \
        'PasswordAuthentication yes' \
        'KbdInteractiveAuthentication yes' \
        'UseDNS no' \
        'AllowTcpForwarding yes' \
        'AllowStreamLocalForwarding yes' \
        > /etc/ssh/sshd_config.d/99-edi-containers.conf \
    && if ! grep -q '^Include.*/etc/ssh/sshd_config.d' /etc/ssh/sshd_config 2>/dev/null; then \
         echo 'Include /etc/ssh/sshd_config.d/*.conf' >> /etc/ssh/sshd_config; \
       fi \
    && sed -i \
         -e 's/^#\?PermitRootLogin.*/PermitRootLogin yes/' \
         -e 's/^#\?PasswordAuthentication.*/PasswordAuthentication yes/' \
         -e 's/^#\?AllowTcpForwarding.*/AllowTcpForwarding yes/' \
         /etc/ssh/sshd_config \
    && rc-update add sshd default \
    && rc-update delete networking default 2>/dev/null || true \
    && rc-update delete networking boot 2>/dev/null || true

CMD ["/sbin/init"]
