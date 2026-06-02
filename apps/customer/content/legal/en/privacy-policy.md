# Privacy Policy

**CuteBunny Rental**
Last updated: 28 May 2026
Effective date: 28 May 2026

---

## 1. Introduction

<!-- TODO: legal review — verify scope and legal language -->

CuteBunny Rental ("we", "us", "our") provides dress rental services through the website www.cutebunnyrental.com ("Website") and related online channels. This Privacy Policy explains how we collect, use, disclose, and protect your personal data in accordance with Thailand's Personal Data Protection Act B.E. 2562 (PDPA).

By using our services, you acknowledge that you have read and understood this policy.

---

## 2. Personal Data We Collect

### 2.1 Data You Provide Directly

<!-- TODO: legal review — verify completeness of data categories -->

- **Account information**: Full name, email, password (encrypted)
- **Order information**: Shipping address, payment details (via payment processor), rental history
- **Identity verification**: Uploaded documents (ID card/passport — first rental only)

### 2.2 Data from LINE Login

<!-- TODO: legal review — verify LINE disclosure requirements are met -->

When you choose to sign in via LINE Login, we receive the following data from LINE Corporation:

| Data | Description |
|------|-------------|
| LINE User ID | Your unique identifier in the LINE system |
| Display Name | The name you have set on LINE |
| Profile Picture URL | URL of your LINE profile picture |
| Email | Only if you grant permission via OIDC email scope |

We use LINE data solely to create and link your customer account in our system.

### 2.3 Data Collected Automatically

- **Usage data**: Pages visited, visit times, device and browser information
- **IP Address**: Stored in Admin Audit Log for security purposes (see retention details in Section 6)
- **Cookies**: See Section 9

---

## 3. Purposes of Data Processing

<!-- TODO: legal review — verify purposes and legal bases -->

| Purpose | Legal Basis (PDPA) |
|---------|--------------------|
| Identity verification and account management | Contractual necessity (Section 24(3)) |
| Processing dress rentals and delivery | Contractual necessity (Section 24(3)) |
| Payment processing and invoicing | Contractual necessity (Section 24(3)) |
| Order-related communications | Contractual necessity (Section 24(3)) |
| Customer service via LINE OA | Contractual necessity (Section 24(3)) |
| Newsletters, promotions, marketing | Consent (Section 19) |
| Fraud prevention and security | Legitimate interest (Section 24(5)) |
| Legal compliance (tax, accounting) | Legal obligation (Section 24(6)) |

---

## 4. Disclosure to Third Parties

<!-- TODO: legal review — verify processor list and DPA/SCC status -->

We may disclose your personal data to the following third parties:

| Data Processor | Service | Location |
|---------------|---------|----------|
| Supabase (AWS) | Database hosting | United States / Singapore |
| Cloudflare | CDN, Workers (API), security | Global |
| Stripe | Payment processing | United States |
| LINE Corporation | Login + messaging | Japan |

Cross-border data transfers are conducted in accordance with PDPA Sections 28-29, with appropriate safeguards in place.

---

## 5. Data Retention

<!-- TODO: legal review — verify retention periods per Thai Revenue Code -->

| Data Type | Retention Period | Reason |
|-----------|-----------------|--------|
| Customer account data | Duration of active account + 5 years after last order | Thai Revenue Code — accounting and tax law |
| Order data / receipts | 5 years after order | Thai Revenue Code |
| IP Address (Audit Log) | 0-30 days: full / 31-90 days: partially masked / 90+ days: deleted | Security |
| LINE Login data | Duration of account linkage | Contractual necessity |
| Marketing consent | Until consent is withdrawn | PDPA Section 19 |

---

## 6. Your Rights as a Data Subject

<!-- TODO: legal review — verify rights exercise procedures -->

Under PDPA Sections 30-37, you have the following rights:

1. **Right of Access (Section 30)** — Request a copy of your personal data
2. **Right to Rectification (Section 36)** — Request correction of inaccurate or incomplete data
3. **Right to Erasure (Section 33(5))** — Request deletion when data is no longer necessary
4. **Right to Restriction (Section 34)** — Request restriction of data processing
5. **Right to Data Portability (Section 31)** — Receive your data in a machine-readable format
6. **Right to Object (Section 32)** — Object to processing based on legitimate interest
7. **Right to Withdraw Consent (Section 19, para 5)** — Withdraw previously given consent at any time

### How to Exercise Your Rights

Submit a request to:
- **Email**: Cutebunny.rental@gmail.com
- **Response time**: Within 30 days of receiving your request

---

## 7. Children's Data

<!-- TODO: legal review — verify age threshold per PDPA guidance -->

Our services are not intended for persons under the age of 20 (per Thai PDPA guidance for online services). If we become aware that we have collected data from a person under 20 without parental consent, we will promptly delete such data.

---

## 8. Data Security

<!-- TODO: legal review — verify security measures -->

We implement appropriate technical and organizational measures to protect your personal data, including:

- Encryption in transit (TLS/HTTPS)
- Password hashing (bcrypt)
- Role-Based Access Control (RBAC)
- Row Level Security (RLS) on the database
- Activity monitoring through Audit Logs

---

## 9. Cookies

<!-- TODO: legal review — verify cookie types (cookie banner is a separate PR) -->

Our website uses essential cookies required for system operation:

- Login session management
- Language preference storage
- CSRF attack prevention

Further details about cookies will be specified in a separate Cookie Policy.

---

## 10. Policy Changes

We may update this policy from time to time. Significant changes will be communicated to you through the website or email.

---

## 11. Data Protection Officer (DPO)

<!-- TODO: update with actual DPO name and contact -->

- **Name**: Data Protection Officer
- **Email**: Cutebunny.rental@gmail.com
- **Address**: <!-- TODO: specify office address -->

---

## 12. Contact Information

<!-- TODO: update contact details -->

- **Business Name**: CuteBunny Rental
- **Website**: www.cutebunnyrental.com
- **Email**: Cutebunny.rental@gmail.com
- **Phone**: 063-7965557
