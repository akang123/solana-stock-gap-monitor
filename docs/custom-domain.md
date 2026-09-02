# Custom Domain Checklist

The Pages deployment is already configured for workflow-based publishing. To attach a domain:

1. Choose the exact hostname you want to use.
2. Create `site/CNAME` with that hostname on one line.
3. Point a subdomain CNAME at `akang123.github.io`, or use GitHub's published A/AAAA records for an apex domain.
4. Open repository settings, choose **Pages**, set the custom domain, and enable HTTPS.
5. Re-run the workflow after the DNS change and confirm the certificate becomes active.

No domain is hard-coded in this repository until the final hostname is known.
