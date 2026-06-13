import type { Metadata } from 'next';
import { LegalPageShell } from '@/components/marketing/LegalPageShell';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms governing your use of RepairOS.',
};

const EFFECTIVE_DATE = '14 June 2026';

const TOC = [
  { id: 'acceptance',     label: '1. Acceptance of Terms' },
  { id: 'service',        label: '2. Description of Service' },
  { id: 'account',        label: '3. Account Registration' },
  { id: 'subscription',   label: '4. Subscription & Payment' },
  { id: 'acceptable-use', label: '5. Acceptable Use Policy' },
  { id: 'your-data',      label: '6. Your Data' },
  { id: 'ip',             label: '7. Intellectual Property' },
  { id: 'confidentiality',label: '8. Confidentiality' },
  { id: 'disclaimers',    label: '9. Disclaimers & Warranties' },
  { id: 'liability',      label: '10. Limitation of Liability' },
  { id: 'indemnification',label: '11. Indemnification' },
  { id: 'termination',    label: '12. Termination' },
  { id: 'governing-law',  label: '13. Governing Law' },
  { id: 'disputes',       label: '14. Dispute Resolution' },
  { id: 'changes',        label: '15. Changes to Terms' },
  { id: 'contact',        label: '16. Contact' },
];

export default function TermsOfServicePage() {
  return (
    <LegalPageShell title="Terms of Service" effectiveDate={EFFECTIVE_DATE} toc={TOC}>

      <div className="highlight-box">
        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) form a legally binding agreement between you
          (&ldquo;Subscriber&rdquo; or &ldquo;you&rdquo;) and <strong>RepairOS</strong> (&ldquo;we,&rdquo;
          &ldquo;our,&rdquo; or &ldquo;us&rdquo;) governing your access to and use of the RepairOS
          platform and services. Please read these Terms carefully before creating an account.
        </p>
      </div>

      {/* 1 */}
      <h2 id="acceptance">1. Acceptance of Terms</h2>
      <p>
        By registering for an account, clicking &ldquo;I agree,&rdquo; or using any part of the
        RepairOS service, you confirm that you have read, understood, and agree to be bound by these
        Terms and our <a href="/privacy">Privacy Policy</a>, which is incorporated herein by reference.
      </p>
      <p>
        If you are accepting these Terms on behalf of a company or other legal entity, you represent
        that you have the authority to bind that entity. In that case, &ldquo;you&rdquo; refers to that
        entity. If you do not have such authority, you must not accept these Terms or use the service.
      </p>
      <p>
        If you do not agree to these Terms, do not register for or use RepairOS.
      </p>

      {/* 2 */}
      <h2 id="service">2. Description of Service</h2>
      <p>
        RepairOS is a cloud-based, multi-tenant SaaS platform for repair shop management. The service
        includes, but is not limited to:
      </p>
      <ul>
        <li>Repair job tracking and technician management</li>
        <li>Customer Relationship Management (CRM) and lead pipeline</li>
        <li>Point of Sale (POS) for counter sales</li>
        <li>Inventory and purchase order management</li>
        <li>GST-compliant billing, invoicing, and payment tracking</li>
        <li>Annual Maintenance Contract (AMC) management</li>
        <li>HR, commissions, and staff management</li>
        <li>WhatsApp notification templates and delivery</li>
        <li>Reports and analytics dashboards</li>
      </ul>
      <p>
        We reserve the right to modify, add, or discontinue features at any time. We will provide
        reasonable notice of material changes that affect your current use.
      </p>

      {/* 3 */}
      <h2 id="account">3. Account Registration</h2>
      <p>To use RepairOS, you must:</p>
      <ul>
        <li>Provide accurate, complete, and up-to-date registration information, including a valid GSTIN where applicable</li>
        <li>Maintain the security of your account credentials and not share them with unauthorised persons</li>
        <li>Promptly notify us of any suspected unauthorised access at <strong>support@repairosapp.com</strong></li>
        <li>Be at least 18 years of age and have legal capacity to enter into contracts under Indian law</li>
      </ul>
      <p>
        You are responsible for all activity that occurs under your account, including actions taken by
        your staff members using sub-accounts you create. Each workspace is allocated to a single
        business entity. Creating multiple workspaces to circumvent subscription limits is prohibited.
      </p>

      {/* 4 */}
      <h2 id="subscription">4. Subscription &amp; Payment</h2>

      <h3>4.1 Plans</h3>
      <p>
        RepairOS is offered on a subscription basis. Pricing, features, and billing cycles for available
        plans are described on our pricing page or communicated to you during registration. All prices are
        in Indian Rupees (INR) and are exclusive of applicable GST unless otherwise stated.
      </p>

      <h3>4.2 Billing</h3>
      <p>
        Subscription fees are billed in advance on a monthly or annual basis, depending on the plan you
        select. By providing payment details, you authorise us to charge the applicable fees on each
        billing date. If a payment fails, we will attempt to notify you and may suspend access until
        payment is resolved.
      </p>

      <h3>4.3 Refunds</h3>
      <p>
        Monthly subscriptions are non-refundable once the billing period has begun. For annual plans,
        we offer a pro-rated refund for the unused portion if you cancel within the first 30 days of
        your initial annual subscription. No refunds are issued for subsequent annual renewals.
      </p>

      <h3>4.4 Free Trial</h3>
      <p>
        If we offer a free trial, your access is limited to the trial period and feature set specified
        at sign-up. At the end of the trial, you must subscribe to continue using the service. We
        reserve the right to end or modify free trial terms at any time.
      </p>

      <h3>4.5 Price Changes</h3>
      <p>
        We may change subscription prices with at least <strong>30 days&rsquo; written notice</strong>.
        Price changes will take effect at the start of your next billing period after the notice period.
      </p>

      {/* 5 */}
      <h2 id="acceptable-use">5. Acceptable Use Policy</h2>
      <p>You agree to use RepairOS only for lawful business purposes. You must not:</p>
      <ul>
        <li>Use the platform to store, process, or transmit any data that violates applicable Indian law, including the IT Act, 2000 or the DPDP Act, 2023</li>
        <li>Enter false, misleading, or fraudulent data about customers or transactions</li>
        <li>Send unsolicited or spam WhatsApp messages to customers who have not consented to receive them</li>
        <li>Attempt to gain unauthorised access to other tenants&rsquo; data or to our backend systems</li>
        <li>Reverse-engineer, decompile, or disassemble any part of the platform</li>
        <li>Use the platform to compete with RepairOS or to build a competing product</li>
        <li>Sublicense, resell, or offer the service as a white-label product without our written permission</li>
        <li>Introduce malware, viruses, or any code designed to disrupt or damage the platform</li>
        <li>Exceed rate limits or otherwise place unreasonable load on our infrastructure</li>
      </ul>
      <p>
        Violation of this policy may result in immediate account suspension without notice and, where
        applicable, reporting to relevant authorities.
      </p>

      {/* 6 */}
      <h2 id="your-data">6. Your Data</h2>

      <h3>6.1 Ownership</h3>
      <p>
        All business data you enter into RepairOS — including customer records, repair jobs, invoices,
        and inventory — remains your property. We do not claim ownership of your data.
      </p>

      <h3>6.2 Licence to Process</h3>
      <p>
        You grant us a limited, non-exclusive, non-transferable licence to store, process, and display
        your data solely for the purpose of providing the RepairOS service to you. This licence ends
        when your account is terminated and your data is deleted in accordance with our{' '}
        <a href="/privacy">Privacy Policy</a>.
      </p>

      <h3>6.3 Data Responsibility</h3>
      <p>
        As a Subscriber, you are the data controller for your customers&rsquo; personal data. You are
        responsible for ensuring you have a lawful basis for collecting and processing that data, and
        for complying with the DPDP Act, 2023 and other applicable privacy laws. We act as your data
        processor.
      </p>

      <h3>6.4 Data Export</h3>
      <p>
        You may export your data in CSV or other available formats at any time from within the platform.
        Upon account termination, you will have 30 days to download your data before it is deleted.
      </p>

      {/* 7 */}
      <h2 id="ip">7. Intellectual Property</h2>
      <p>
        RepairOS and its content, features, code, design, trademarks, and branding (&ldquo;RepairOS
        IP&rdquo;) are owned by us and protected under Indian and international intellectual property
        laws. These Terms do not grant you any rights in RepairOS IP beyond the limited subscription
        licence to use the platform as intended.
      </p>
      <p>
        Any feedback, suggestions, or ideas you share with us may be used by us to improve the platform
        without any obligation or compensation to you.
      </p>

      {/* 8 */}
      <h2 id="confidentiality">8. Confidentiality</h2>
      <p>
        Each party agrees to maintain the confidentiality of the other&rsquo;s non-public information
        disclosed during the course of this relationship (&ldquo;Confidential Information&rdquo;).
        Neither party will disclose the other&rsquo;s Confidential Information to third parties without
        prior written consent, except as required by law or to fulfil obligations under these Terms.
      </p>
      <p>
        Your business data, subscription pricing, and support correspondence are treated as your
        Confidential Information. Our proprietary platform features and roadmap are our Confidential
        Information.
      </p>

      {/* 9 */}
      <h2 id="disclaimers">9. Disclaimers &amp; Warranties</h2>
      <p>
        RepairOS is provided on an <strong>&ldquo;as is&rdquo; and &ldquo;as available&rdquo;</strong>{' '}
        basis. To the maximum extent permitted by applicable law, we disclaim all warranties, express
        or implied, including warranties of merchantability, fitness for a particular purpose, and
        non-infringement.
      </p>
      <p>We do not warrant that:</p>
      <ul>
        <li>The service will be uninterrupted, error-free, or secure at all times</li>
        <li>Results obtained from the service will be accurate or reliable</li>
        <li>Defects will be corrected within any particular timeframe</li>
      </ul>
      <p>
        We target 99.5% monthly uptime for the core platform. We will publish scheduled maintenance
        windows in advance and aim to conduct them during low-usage periods.
      </p>

      {/* 10 */}
      <h2 id="liability">10. Limitation of Liability</h2>
      <p>
        To the maximum extent permitted by Indian law, RepairOS and its directors, employees, and
        contractors shall not be liable for any indirect, incidental, special, consequential, or
        punitive damages, including loss of revenue, loss of data, or loss of business, arising out of
        your use of or inability to use the service.
      </p>
      <p>
        Our total aggregate liability to you for any claims arising under or related to these Terms
        shall not exceed the amount you paid to us in the <strong>three (3) months</strong> preceding
        the event giving rise to the claim.
      </p>
      <p>
        Some jurisdictions do not allow exclusion of certain warranties or limitation of liability.
        Where such restrictions apply, our liability will be limited to the minimum extent permitted
        by law.
      </p>

      {/* 11 */}
      <h2 id="indemnification">11. Indemnification</h2>
      <p>
        You agree to indemnify, defend, and hold harmless RepairOS and its officers, directors,
        employees, and agents from and against any claims, liabilities, damages, losses, costs, and
        expenses (including reasonable legal fees) arising out of:
      </p>
      <ul>
        <li>Your use of the platform in violation of these Terms</li>
        <li>Your violation of any applicable law or third-party right</li>
        <li>Data you entered into RepairOS (including claims by your customers regarding their personal data)</li>
        <li>WhatsApp messages sent to your customers through the platform</li>
      </ul>

      {/* 12 */}
      <h2 id="termination">12. Termination</h2>

      <h3>12.1 By You</h3>
      <p>
        You may cancel your subscription at any time from your account settings or by contacting
        support. Cancellation takes effect at the end of your current billing period. You will retain
        access to the platform until that date.
      </p>

      <h3>12.2 By Us</h3>
      <p>We may suspend or terminate your account immediately if:</p>
      <ul>
        <li>You materially breach these Terms and fail to cure the breach within 7 days of written notice</li>
        <li>You engage in conduct that poses a security or legal risk to RepairOS or other users</li>
        <li>Your subscription payment remains outstanding for more than 14 days after the due date</li>
        <li>We are required to do so by law or court order</li>
      </ul>
      <p>
        We may also terminate the service with <strong>30 days&rsquo; notice</strong> if we decide to
        wind down the platform, with a pro-rated refund where applicable.
      </p>

      <h3>12.3 Effect of Termination</h3>
      <p>
        Upon termination, your right to access the service ends. We will retain your data for 30 days
        to allow export, after which it will be permanently deleted. Sections 6, 7, 8, 10, 11, 13, and
        14 survive termination.
      </p>

      {/* 13 */}
      <h2 id="governing-law">13. Governing Law</h2>
      <p>
        These Terms shall be governed by and construed in accordance with the laws of the
        <strong> Republic of India</strong>. The courts of <strong>Mumbai, Maharashtra</strong> shall
        have exclusive jurisdiction over any disputes, subject to the arbitration clause below.
      </p>

      {/* 14 */}
      <h2 id="disputes">14. Dispute Resolution</h2>
      <p>
        We encourage you to contact us first at <strong>support@repairosapp.com</strong> to resolve any
        concern informally. Most issues can be resolved quickly this way.
      </p>
      <p>
        If a dispute cannot be resolved informally within 30 days, both parties agree to attempt
        mediation through a mutually agreed mediator before initiating formal legal proceedings.
      </p>
      <p>
        For disputes involving claims above ₹10,00,000 (Ten Lakh Rupees), either party may elect
        binding arbitration under the Arbitration and Conciliation Act, 1996 (India). The seat of
        arbitration shall be Mumbai. Proceedings shall be conducted in English.
      </p>
      <p>
        Nothing in this section prevents either party from seeking urgent interim or injunctive relief
        from a competent court.
      </p>

      {/* 15 */}
      <h2 id="changes">15. Changes to Terms</h2>
      <p>
        We may update these Terms at any time. For material changes, we will provide at least{' '}
        <strong>14 days&rsquo; notice</strong> via email or in-platform notification before the new
        Terms take effect. Your continued use of the service after that date constitutes acceptance
        of the updated Terms.
      </p>
      <p>
        If you do not agree to the updated Terms, you must stop using the service and may cancel your
        subscription before the change takes effect. We will not penalise you for cancelling within
        the notice period.
      </p>

      {/* 16 */}
      <h2 id="contact">16. Contact</h2>
      <p>
        For any questions about these Terms, please contact us at:
      </p>
      <div className="highlight-box">
        <p><strong>RepairOS — Legal</strong></p>
        <p>Email: <strong>legal@repairosapp.com</strong></p>
        <p>Subject line: <em>Terms of Service Inquiry</em></p>
      </div>

    </LegalPageShell>
  );
}
