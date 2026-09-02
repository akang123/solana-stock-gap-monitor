# Custom Domain Checklist

The Pages deployment uses workflow-based publishing and is prepared for `solanastockgapmonitor.site`.

1. At the registrar, remove any parking records for the apex (`@`) host.
2. Add A records for `@` pointing to `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, and `185.199.111.153`.
3. Optionally point `www` to `akang123.github.io` with a CNAME record.
4. Confirm `site/CNAME` contains only `solanastockgapmonitor.site`.
5. In **GitHub → repository Settings → Pages**, set the custom domain to `solanastockgapmonitor.site`.
6. Keep **Enforce HTTPS** enabled after GitHub provisions the certificate.
7. Re-run `refresh-and-deploy.yml` after DNS propagation and confirm the certificate becomes active.

Do not create a CNAME record for the apex (`@`); use the four A records instead.
