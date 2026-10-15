#!/bin/sh
set -eu
tls_ip=${1:?Provide the Pi LAN IPv4 address}
case "$tls_ip" in *[!0-9.]*|'') echo 'Provide an IPv4 address' >&2; exit 1;; esac
tls_dir=/etc/conkiosk/tls
if [ -e "$tls_dir/server.key" ] || [ -e "$tls_dir/ca.key" ]; then
    echo 'TLS files already exist; refusing to overwrite them.' >&2
    exit 1
fi
umask 077
mkdir -p "$tls_dir"
openssl req -x509 -newkey rsa:3072 -nodes -days 3650 -keyout "$tls_dir/ca.key" -out "$tls_dir/ca.crt" -subj '/CN=ConKiosk Local LAN CA' -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign'
openssl req -new -newkey rsa:2048 -nodes -keyout "$tls_dir/server.key" -out "$tls_dir/server.csr" -subj '/CN=conkiosk.local' -addext "subjectAltName=IP:$tls_ip,IP:127.0.0.1,DNS:conkiosk.local,DNS:localhost" -addext 'extendedKeyUsage=serverAuth' -addext 'basicConstraints=critical,CA:FALSE'
openssl x509 -req -in "$tls_dir/server.csr" -CA "$tls_dir/ca.crt" -CAkey "$tls_dir/ca.key" -CAcreateserial -days 365 -copy_extensions copy -out "$tls_dir/server.crt"
openssl verify -CAfile "$tls_dir/ca.crt" "$tls_dir/server.crt"
openssl x509 -in "$tls_dir/ca.crt" -noout -fingerprint -sha256
echo 'Install ca.crt on client devices; keep ca.key and server.key private.'
