import type { Metadata } from 'next';
import { LegalPageShell } from '@/components/marketing/LegalPageShell';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How RepairOS collects, uses, and protects your data.',
};

const EFFECTIVE_DATE = '14 June 2026';

const TOC = [
  { id: 'who-we-are',        label: '1. Who We Are' },
  { id: 'information',       label: '2. Information We Collect' },
  { id: 'how-we-use',        label: '3. How We Use Your Information' },
  { id: 'sharing',           label: '4. Data Sharing & Disclosure' },
  { id: 'security',          label: '5. Data Security' },
  { id: 'retention',         label: '6. Data Retention' },
  { id: 'your-rights',       label: '7. Your Rights' },
  { id: 'cookies',           label: '8. Cookies & Tracking' },
  { id: 'third-party',       label: '9. Third-Party Services' },
  { id: 'childrens',         label: '10. Children\'s Privacy' },
  { id: 'grievance',         label: '11. Grievance Officer' },
  { id: 'changes',           label: '12. Changes to This Policy' },
  { id: 'contact',           label: '13. Contact Us' },
];

export default function PrivacyPolicyPage() {
  return (
    <LegalPageShell title="Privacy Policy" effectiveDate={EFFECTIVE_DATE} toc={TOC}>

      <div className="highlight-box">
        <p>
          This Privacy Policy explains how <strong>RepairOS</strong> (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or
          &ldquo;us&rdquo;) collects, uses, stores, and protects information when you use our repair shop
          management platform. By creating an account or using our services, you agree to the practices
          described in this policy.
        </p>
      </div>

      {/* 1 */}
      <h2 id="who-we-are">1. Who We Are</h2>
      <p>
        RepairOS is a multi-tenant Software-as-a-Service (SaaS) platform designed to help repair shop
        owners manage jobs, customers, invoices, inventory, and more. Our services are provided to
        businesses (&ldquo;Subscribers&rdquo;) operating in India.
      </p>
      <p>
        For the purposes of this policy, RepairOS acts as a <strong>data processor</strong> on behalf of
        Subscribers with respect to the data they enter about their own customers and business operations.
        RepairOS acts as a <strong>data controller</strong> for the account and usage information it
        collects directly from Subscribers.
      </p>

      {/* 2 */}
      <h2 id="information">2. Information We Collect</h2>

      <h3>2.1 Account &amp; Business Information</h3>
      <p>When you register and set up your shop, we collect:</p>
      <ul>
        <li>Business name, owner name, email address, and phone number</li>
        <li>GSTIN (GST Identification Number) and business address</li>
        <li>Workspace subdomain and login credentials (passwords are stored as salted hashes)</li>
        <li>Payment and billing information (processed via our payment partners — we do not store card details)</li>
      </ul>

      <h3>2.2 Business Operational Data</h3>
      <p>
        Data entered by you or your staff while using RepairOS, including:
      </p>
      <ul>
        <li>Customer names, phone numbers, email addresses, and device information</li>
        <li>Repair job details, technician assignments, and job status records</li>
        <li>Invoices, payment records, and GST transaction data</li>
        <li>Inventory items, purchase orders, and supplier details</li>
        <li>AMC (Annual Maintenance Contract) records and service schedules</li>
        <li>HR records, staff profiles, and commission data</li>
        <li>Lead and CRM data</li>
      </ul>
      <p>
        This data belongs to your business. We process it only to provide and improve the platform on
        your behalf.
      </p>

      <h3>2.3 Usage &amp; Technical Data</h3>
      <p>When you access the platform, we automatically collect:</p>
      <ul>
        <li>IP address, browser type, and device identifiers</li>
        <li>Pages visited, features used, and session timestamps</li>
        <li>Error logs and performance metrics</li>
        <li>PWA install status and service worker activity</li>
      </ul>

      <h3>2.4 Communication Data</h3>
      <p>
        When you contact our support team, we retain records of that correspondence, including email
        content and any attachments you provide.
      </p>

      {/* 3 */}
      <h2 id="how-we-use">3. How We Use Your Information</h2>
      <p>We use the information we collect to:</p>
      <ul>
        <li><strong>Provide the service</strong> — operate your account, display your data, and run platform features</li>
        <li><strong>Process transactions</strong> — handle subscription payments and send invoices</li>
        <li><strong>Send WhatsApp notifications</strong> — deliver job status updates and reminders to your customers on your behalf, using message templates you configure</li>
        <li><strong>Communicate with you</strong> — send service announcements, security alerts, and support responses</li>
        <li><strong>Improve the platform</strong> — analyse aggregated usage patterns to fix bugs and build new features (individual business data is never used for this)</li>
        <li><strong>Comply with law</strong> — respond to legal obligations, court orders, or regulatory requirements under Indian law</li>
        <li><strong>Prevent fraud and abuse</strong> — detect and investigate misuse of the platform</li>
      </ul>
      <p>
        We do <strong>not</strong> use your customers&rsquo; personal data for advertising, profiling, or
        any purpose other than operating your RepairOS account.
      </p>

      {/* 4 */}
      <h2 id="sharing">4. Data Sharing &amp; Disclosure</h2>
      <p>We do not sell your data. We share data only in the following circumstances:</p>

      <h3>4.1 Service Providers</h3>
      <p>
        We engage trusted third-party vendors to operate our infrastructure. These include cloud hosting
        providers, database services, email delivery, and payment processors. All vendors are bound by
        data processing agreements and are permitted to use your data only to perform services for us.
      </p>

      <h3>4.2 WhatsApp / Meta</h3>
      <p>
        When you send WhatsApp notifications through RepairOS, your customers&rsquo; phone numbers and
        the message content are transmitted to Meta Platforms (WhatsApp) via the WhatsApp Business API.
        This transmission is governed by Meta&rsquo;s Privacy Policy. You are responsible for obtaining
        any necessary consent from your customers before sending them messages.
      </p>

      <h3>4.3 Legal Requirements</h3>
      <p>
        We may disclose data if required by law, regulation, or a valid order from an Indian government
        authority or court. We will notify you where legally permissible.
      </p>

      <h3>4.4 Business Transfers</h3>
      <p>
        In the event of a merger, acquisition, or sale of all or part of our business, data may be
        transferred as part of that transaction. We will notify affected Subscribers in advance.
      </p>

      {/* 5 */}
      <h2 id="security">5. Data Security</h2>
      <p>We implement industry-standard safeguards including:</p>
      <ul>
        <li>Encryption in transit (TLS 1.2+) and at rest for all stored data</li>
        <li>Database-per-tenant architecture ensuring strict data isolation between shops</li>
        <li>Role-based access controls limiting staff access within your account</li>
        <li>Regular security testing and dependency auditing</li>
        <li>Secure credential hashing (passwords are never stored in plain text)</li>
      </ul>
      <p>
        While we take every reasonable precaution, no system is 100% secure. You are responsible for
        maintaining the confidentiality of your account credentials and for your staff&rsquo;s actions
        within your RepairOS account.
      </p>

      {/* 6 */}
      <h2 id="retention">6. Data Retention</h2>
      <p>
        We retain your account and business data for as long as your subscription is active. If you
        cancel your account:
      </p>
      <ul>
        <li>Your data remains accessible for <strong>30 days</strong> from the cancellation date, allowing you to export it.</li>
        <li>After 30 days, your data is permanently deleted from our production systems.</li>
        <li>Backup copies may persist for up to <strong>90 days</strong> before being purged from backup storage.</li>
        <li>We retain financial transaction records (invoices paid to RepairOS) for <strong>7 years</strong> as required under Indian GST and accounting regulations.</li>
      </ul>

      {/* 7 */}
      <h2 id="your-rights">7. Your Rights</h2>
      <p>
        Under the <strong>Digital Personal Data Protection Act, 2023 (DPDP Act)</strong> and applicable
        Indian law, you have the right to:
      </p>
      <ul>
        <li><strong>Access</strong> — request a summary of the personal data we hold about you</li>
        <li><strong>Correct</strong> — request correction of inaccurate or incomplete personal data</li>
        <li><strong>Erase</strong> — request deletion of your personal data, subject to legal retention obligations</li>
        <li><strong>Nominate</strong> — nominate another individual to exercise these rights on your behalf in the event of death or incapacity</li>
        <li><strong>Withdraw consent</strong> — where processing is based on consent, withdraw it at any time (this may affect your ability to use certain features)</li>
        <li><strong>Grievance redress</strong> — raise a complaint with our Grievance Officer (see Section 11)</li>
      </ul>
      <p>
        To exercise any of these rights, email us at <strong>privacy@repairosapp.com</strong> with the
        subject line &ldquo;Data Rights Request.&rdquo; We will respond within 30 days.
      </p>
      <p>
        As a Subscriber, you are also the data controller for your customers&rsquo; personal data. You
        are responsible for managing their rights requests regarding data you have entered into RepairOS.
        We will assist you in fulfilling such requests upon written request.
      </p>

      {/* 8 */}
      <h2 id="cookies">8. Cookies &amp; Tracking</h2>
      <p>RepairOS uses a minimal set of cookies and local storage:</p>
      <ul>
        <li><strong>Session cookies</strong> — maintain your login state; expire when you close the browser</li>
        <li><strong>Preference storage</strong> — store UI preferences (e.g., sidebar collapsed state, dark mode) in localStorage; no expiry</li>
        <li><strong>Offline cache</strong> — the PWA service worker caches app assets and queued actions for offline use</li>
      </ul>
      <p>
        We do <strong>not</strong> use advertising cookies, cross-site tracking pixels, or third-party
        analytics cookies. You can clear all stored data by clearing your browser&rsquo;s site data for
        repairosapp.com.
      </p>

      {/* 9 */}
      <h2 id="third-party">9. Third-Party Services</h2>
      <p>Our platform integrates with the following third-party services:</p>
      <ul>
        <li><strong>WhatsApp Business API (Meta)</strong> — for sending notifications to your customers</li>
        <li><strong>Cloud hosting provider</strong> — for secure data storage and compute</li>
        <li><strong>Payment gateway</strong> — for processing your subscription payments</li>
      </ul>
      <p>
        Each of these providers has its own privacy policy. We encourage you to review them. We are not
        responsible for the data practices of third-party services.
      </p>

      {/* 10 */}
      <h2 id="childrens">10. Children&rsquo;s Privacy</h2>
      <p>
        RepairOS is a business-to-business platform. We do not knowingly collect personal data from
        individuals under the age of 18. If you believe a minor has provided us personal data, please
        contact us immediately at privacy@repairosapp.com and we will delete it promptly.
      </p>

      {/* 11 */}
      <h2 id="grievance">11. Grievance Officer</h2>
      <p>
        In accordance with the Information Technology Act, 2000, and the DPDP Act, 2023, we have
        appointed a Grievance Officer to address data-related concerns:
      </p>
      <div className="highlight-box">
        <p><strong>Grievance Officer — RepairOS</strong></p>
        <p>Email: <strong>grievance@repairosapp.com</strong></p>
        <p>Response time: within <strong>30 days</strong> of receipt of complaint</p>
      </div>
      <p>
        If you are not satisfied with our response, you may escalate the matter to the Data Protection
        Board of India once it is constituted under the DPDP Act, 2023.
      </p>

      {/* 12 */}
      <h2 id="changes">12. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. When we make material changes, we will
        notify you via email (to the address on your account) and display a notice in the platform at
        least <strong>14 days</strong> before the change takes effect. Continued use of RepairOS after
        that date constitutes acceptance of the updated policy.
      </p>
      <p>
        The current effective date is always shown at the top of this page. Archived versions are
        available upon request.
      </p>

      {/* 13 */}
      <h2 id="contact">13. Contact Us</h2>
      <p>For privacy-related questions or requests, contact us at:</p>
      <div className="highlight-box">
        <p><strong>RepairOS — Privacy Team</strong></p>
        <p>Email: <strong>privacy@repairosapp.com</strong></p>
        <p>Subject line: <em>Privacy Inquiry</em></p>
      </div>

    </LegalPageShell>
  );
}
