# Tailscale, HTTPS and DNS

[Knowledge base index](README.md) · [Pi deployment](07-raspberry-pi.md) · [Troubleshooting](11-troubleshooting.md)

Family Hub is intended for the household's private network/VPN, not the public Internet. Tailscale joins the Pi and authorized phones/tablets to the same private tailnet. Tailscale Serve terminates HTTPS and proxies to the Pi's loopback-only web client. Serve is different from Funnel; Funnel is not enabled for this deployment. Do not add router port forwarding to make the app work.

## Connect a device

1. Install and sign in to Tailscale on the iPhone, iPad or other authorized device, using the household tailnet.
2. Connect the Tailscale VPN. Confirm the Pi appears in the device list and is online.
3. Open the Pi's full private HTTPS hostname in Safari. Find the current address with `tailscale serve status` on the Pi. Use the full URL, not a Pi LAN IP with an invalid HTTPS certificate.
4. Sign into Family Hub separately. Tailscale access is a network boundary, not a replacement for the app's login.

The initial Pi enrollment and the separate tailnet HTTPS/Serve approval were completed by the owner. Other devices must join the same tailnet and satisfy its access rules. Enabling HTTPS in a tailnet can publish machine and tailnet DNS names in certificate transparency logs; review [Tailscale's HTTPS documentation](https://tailscale.com/docs/how-to/set-up-https-certificates) before enabling it on a different tailnet.

## MagicDNS and the DNS resolver

MagicDNS is enabled for this tailnet. It supplies the Pi's private `*.ts.net` name to Tailscale-connected devices. A device can see the Pi in the Tailscale app yet Safari can still fail to resolve its hostname if another DNS configuration overrides Tailscale DNS.

During acceptance, a the DNS resolver configuration caused Safari's “server can't be found” error; disabling it allowed access. If this recurs, confirm Tailscale is connected, temporarily disable the conflicting DNS profile/app and retry the full HTTPS URL. To use the DNS resolver alongside Family Hub, configure the specific client or network so Tailscale's private DNS handles its tailnet names; the exact method depends on whether the DNS resolver was configured in an iOS profile, app, router or another DNS service. Re-enable protection after testing and avoid weakening unrelated network settings. See [Tailscale DNS troubleshooting](https://tailscale.com/docs/reference/troubleshooting/resolve-domain-names-failure).

## The photo frame's network

The frame cannot run Tailscale. It reaches a separate, display-only HTTPS listener on the Pi's LAN address as `frame.example.com`. That public DNS record (Cloudflare, DNS only) points at a private address, so it resolves anywhere but only connects inside the house; the frame uses ordinary DHCP DNS. An earlier attempt to make the Pi the frame's DNS server failed because Android preferred the router's IPv6 DNS servers. Management never goes through this path. See [the photo frame](16-photo-frame.md).

## Useful checks

```sh
tailscale status
tailscale serve status
tailscale dns status
```

On the Pi, the Serve status should show a tailnet-only HTTPS proxy to `127.0.0.1:8080`. A successful request on the Pi does not prove a phone has working Tailscale DNS. Avoid bypassing certificate warnings; verify the hostname, time and tailnet configuration instead.
