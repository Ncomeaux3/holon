import type { Metadata } from 'next'
import Link from 'next/link'
import { LEGAL } from '@/core/legal'
import { Contact, LegalDoc, Section } from '../doc'

export const metadata: Metadata = { title: 'Terms of service · Holon' }

export default function TermsPage() {
  return (
    <LegalDoc
      title="Terms of service"
      lede={
        <>
          <p>
            These terms are an agreement between you and {LEGAL.operator}, an individual in{' '}
            {LEGAL.governingState}, United States (&quot;we&quot;, &quot;us&quot;), who runs {LEGAL.product}{' '}
            (&quot;the service&quot;). By creating an account, signing in or using the service, you agree to them.
            If you do not agree, do not use it.
          </p>
          <p>
            <strong>Please read section 17.</strong> It says most disputes are decided by individual arbitration
            rather than in court, and that you give up class actions, unless you opt out within 30 days.
          </p>
        </>
      }
    >
      <Section id="eligibility" title="1. Who can use it">
        <p>
          You must be at least 18 years old, and old enough to enter a binding contract where you live (19 in
          Alabama and Nebraska, 21 in Mississippi). You must live in the United States. You may not use the
          service if the law or a previous suspension by us bars you. You use it for yourself, not on behalf of
          a company, unless we agree in writing.
        </p>
      </Section>

      <Section id="beta" title="2. A beta">
        <p>
          The service is an early version, provided free of charge while in beta. Features can change, break or
          be removed, and information can be lost. Keep your own copies of anything important, and do not rely
          on the service as the only record of anything. We may end the beta, and will give at least 30
          days&apos; notice and a way to export your information before we do, unless the law or a security
          threat requires faster action.
        </p>
      </Section>

      <Section id="account" title="3. Your account">
        <p>
          Keep access to your email and passkeys secure; anyone who can sign in as you can see and change your
          information. Tell us promptly if you think someone else has. Give accurate information, and keep your
          email address current so notices reach you.
        </p>
      </Section>

      <Section id="content" title="4. Your information and content">
        <p>
          What you put into the service is yours. You give us permission to store, copy, process and display
          it only as needed to run the service for you, including through the providers named in the{' '}
          <Link href="/privacy">Privacy Policy</Link>. That permission ends when you delete the content or your
          account, apart from copies in backups until they are rotated out. You are responsible for having the
          right to upload what you upload.
        </p>
        <p>
          If you send us ideas or feedback, we may use them without obligation to you.
        </p>
      </Section>

      <Section id="use" title="5. Acceptable use">
        <p>Do not:</p>
        <ul>
          <li>break the law, or use the service to harm, harass or defraud anyone;</li>
          <li>upload content you have no right to, or that infringes someone else&apos;s rights;</li>
          <li>upload malware, or try to reach accounts, data or systems that are not yours;</li>
          <li>probe, scan or load-test the service, or get around its limits or security;</li>
          <li>scrape it, resell it, or build a competing product from it;</li>
          <li>connect accounts that do not belong to you.</li>
        </ul>
      </Section>

      <Section id="advice" title="6. Not professional advice">
        <p>
          The service helps you organize your own information. It does not give medical, financial,
          investment, tax, insurance or legal advice, and nothing in it is a substitute for a qualified
          professional. Health features do not diagnose, treat or monitor any condition. In an emergency, call
          911.
        </p>
        <p>
          Budgets, balances, categories and net worth figures come from what your bank and you provide, and can
          be incomplete, late or wrong. Check anything important against the original source before you act on
          it.
        </p>
      </Section>

      <Section id="ai" title="7. AI features">
        <p>
          Some features use AI to summarize, transcribe, extract, research or suggest. AI output can be wrong,
          incomplete or out of date, and may cite sources that do not say what it claims. Review it before you
          rely on it. You are responsible for what you do with it.
        </p>
      </Section>

      <Section id="reminders" title="8. Reminders and notifications">
        <p>
          Reminders, alerts, digests and calendar entries are a convenience. They can arrive late or not at
          all: a phone can block them, a provider can fail, a sync can stop. Do not rely on the service alone
          for anything time critical, such as taking medication, paying a bill, renewing a policy or keeping an
          appointment.
        </p>
      </Section>

      <Section id="third" title="9. Services you connect">
        <p>
          When you connect Google, a bank through SimpleFIN Bridge, Strava, Apple Health or another service,
          your use of that service is governed by its own terms, and we are not responsible for it, for what it
          sends, or for changes it makes to its access. You can disconnect at any time in Settings &gt;
          Connections. The service only reads from connected accounts; it never moves money or changes
          anything in them.
        </p>
      </Section>

      <Section id="paid" title="10. Paid plans">
        <p>
          The service is free during the beta. If we introduce paid plans, this section applies to them, and
          we will give you at least 30 days&apos; notice before any charge. Nothing is charged without your
          express agreement.
        </p>
        <ul>
          <li>
            Before you subscribe, the price, how often you are billed, that the plan renews automatically until
            you cancel, and how to cancel will be shown next to the button you use to subscribe.
          </li>
          <li>You can cancel online at any time, in the same place you subscribed, without contacting us.</li>
          <li>Cancellation takes effect at the end of the period you have paid for; you keep access until then.</li>
          <li>
            We will email you before an annual plan renews, and at least 30 days before any price increase,
            which you can avoid by cancelling.
          </li>
          <li>
            Payments are not refundable for a partly used period, except where the law requires it or we
            decide otherwise. If we end the service, we refund the unused part of any prepaid period.
          </li>
          <li>Prices do not include taxes, which are added where required.</li>
        </ul>
      </Section>

      <Section id="copyright" title="11. Copyright complaints">
        <p>
          We respond to notices of alleged copyright infringement under the Digital Millennium Copyright Act.
          Content in the service is private to each account, but if you believe something stored here infringes
          your copyright, send a notice to our designated agent:
        </p>
        <p>
          {LEGAL.operator}, Copyright Agent, {LEGAL.address}. Email{' '}
          <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>, subject &quot;DMCA notice&quot;.
        </p>
        <p>Your notice must include (17 U.S.C. § 512(c)(3)):</p>
        <ul>
          <li>your physical or electronic signature;</li>
          <li>the copyrighted work you claim is infringed;</li>
          <li>the material you claim infringes it, with enough detail for us to find it;</li>
          <li>your name, address, telephone number and email;</li>
          <li>a statement that you believe in good faith the use is not authorized by the owner, its agent or the law;</li>
          <li>
            a statement, under penalty of perjury, that the notice is accurate and that you are the owner or
            authorized to act for the owner.
          </li>
        </ul>
        <p>
          If your content is removed after a notice and you believe that was a mistake, you may send a counter
          notice with the details required by 17 U.S.C. § 512(g)(3). We end the accounts of repeat infringers
          in appropriate circumstances.
        </p>
      </Section>

      <Section id="ending" title="12. Ending your use">
        <p>
          You can stop using the service at any time and ask us to delete your account. We may suspend or end
          your access if you break these terms, if the law requires it, or if your use puts the service or
          others at risk. Unless the reason is illegal activity or a security threat, we will tell you first
          and give you at least 30 days to export your information. Sections 4 (feedback), 6, 7, 13 to 18 and
          anything else that by its nature should survive, survive the end of this agreement.
        </p>
      </Section>

      <Section id="warranty" title="13. No warranty">
        <p>
          The service is provided &quot;as is&quot; and &quot;as available&quot;. To the fullest extent the law
          allows, we disclaim all warranties, express or implied, including merchantability, fitness for a
          particular purpose, title, non-infringement, and that the service will be uninterrupted, secure,
          error free, or that information in it will be accurate or preserved.
        </p>
      </Section>

      <Section id="liability" title="14. Limits on liability">
        <p>
          To the fullest extent the law allows, we are not liable for any indirect, incidental, special,
          consequential, exemplary or punitive damages, or for lost profits, revenue, data or goodwill, even if
          we were told they were possible. Our total liability for all claims about the service is limited to
          the greater of the amount you paid us in the 12 months before the claim, or US$100.
        </p>
        <p>
          Some laws do not allow some of these limits. Where that is so, they apply only as far as the law
          allows. Nothing in these terms limits liability for fraud, or for death or personal injury caused by
          negligence, or anything else the law does not allow to be limited.
        </p>
      </Section>

      <Section id="indemnity" title="15. Your responsibility to us">
        <p>
          If a third party makes a claim against us because of content you uploaded, your breach of these
          terms, or your breach of the law or someone else&apos;s rights, you will cover our reasonable losses
          and costs, including reasonable legal fees, to the extent the law allows.
        </p>
      </Section>

      <Section id="law" title="16. Governing law">
        <p>
          The laws of the State of {LEGAL.governingState} and applicable United States federal law govern these
          terms, without regard to conflict of law rules. Subject to section 17, disputes will be heard only in
          the state or federal courts located in {LEGAL.governingState}, and you and we consent to their
          jurisdiction.
        </p>
      </Section>

      <Section id="arbitration" title="17. Arbitration and class action waiver">
        <p>
          <strong>Talk to us first.</strong> Before starting any claim, email us a description of it and what
          you want. We both agree to try in good faith to resolve it within 60 days.
        </p>
        <p>
          <strong>Arbitration.</strong> If it is not resolved, any dispute about the service or these terms
          will be decided by binding individual arbitration administered by the American Arbitration
          Association under its Consumer Arbitration Rules, not in court. The Federal Arbitration Act governs
          this section. The arbitration may be held by video or phone, or in the county where you live. We will
          pay any filing and arbitrator fees above what you would pay to file in court.
        </p>
        <p>
          <strong>Exceptions.</strong> Either of us may bring an individual claim in small claims court, and
          either of us may ask a court to stop infringement or misuse of intellectual property.
        </p>
        <p>
          <strong>No class actions.</strong> Claims may be brought only individually, not as a plaintiff or
          class member in any class, consolidated or representative action, and the arbitrator may not combine
          claims of more than one person. If this waiver is found unenforceable for a claim, that claim goes to
          court and not to arbitration.
        </p>
        <p>
          <strong>Opting out.</strong> You can opt out of this section by emailing{' '}
          <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a> within 30 days of first accepting these terms,
          with your name and the subject &quot;Arbitration opt out&quot;. Opting out does not affect anything
          else in these terms.
        </p>
      </Section>

      <Section id="general" title="18. General">
        <ul>
          <li>
            <strong>Changes.</strong> We may update these terms. For a change that matters, we will tell you by
            email or in the app at least 30 days before it takes effect. If you keep using the service after
            that, the new terms apply; if you do not agree, stop using it and we will delete your account on
            request.
          </li>
          <li>
            <strong>Notices.</strong> You agree to receive notices and agreements electronically, by email or in
            the app. Send notices to us at the address below.
          </li>
          <li>
            <strong>Beyond our control.</strong> We are not responsible for failures caused by events outside our
            reasonable control, such as outages at a provider, natural disasters or changes in law.
          </li>
          <li>
            <strong>Transfer.</strong> You may not transfer this agreement. We may transfer it to someone who
            takes over the service, and will tell you if we do.
          </li>
          <li>
            <strong>The whole agreement.</strong> These terms, the Privacy Policy and the Consumer Health Data
            Privacy Policy are the entire agreement between us about the service. If any part is unenforceable,
            the rest still applies. Not enforcing a term is not a waiver of it.
          </li>
          <li>
            <strong>Export and sanctions.</strong> You may not use the service if you are on a US government
            restricted list, or from a country under US embargo.
          </li>
        </ul>
      </Section>

      <Section id="contact" title="19. Contact">
        <Contact />
      </Section>
    </LegalDoc>
  )
}
