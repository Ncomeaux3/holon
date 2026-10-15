import type { Metadata } from 'next'
import Link from 'next/link'
import { LEGAL } from '@/core/legal'
import { Contact, LegalDoc, Section } from '../doc'

export const metadata: Metadata = { title: 'Privacy policy · Holon' }

export default function PrivacyPage() {
  return (
    <LegalDoc
      title="Privacy policy"
      lede={
        <p>
          This policy explains what {LEGAL.product} collects, why, who else receives it, how long it is kept,
          and what you can do about it. {LEGAL.product} is run by {LEGAL.operator}, an individual in{' '}
          {LEGAL.governingState}, United States (&quot;we&quot;, &quot;us&quot;). Health information has its own
          policy as well: the <Link href="/privacy/health">Consumer Health Data Privacy Policy</Link>.
        </p>
      }
    >
      <Section id="summary" title="The short version">
        <ul>
          <li>Your information is used to run {LEGAL.product} for you, and for nothing else.</li>
          <li>We do not sell it, rent it, share it for advertising, or use it to build profiles for anyone else.</li>
          <li>There are no ads, no analytics, no session recording and no tracking cookies.</li>
          <li>You can see, export, correct or delete your information at any time.</li>
          <li>{LEGAL.product} is currently offered only to adults in the United States.</li>
        </ul>
      </Section>

      <Section id="collect" title="What we collect">
        <p><strong>What you give us.</strong></p>
        <ul>
          <li>Your email address, used to sign you in, and the public part of any passkey you register.</li>
          <li>
            What you enter in each part of the app: tasks, goals, projects, notes and the files you add to
            them, ideas, recipes and meal plans, trips, places and loyalty balances, home assets and services,
            insurance policies and their documents, budgets and subscriptions, calendar events, workouts and
            training plans, and health records, vitals, medications, screenings and appointments.
          </li>
          <li>Your settings, such as your time zone, theme and notification choices.</li>
          <li>Anything you send us by email.</li>
        </ul>
        <p><strong>What comes from services you connect.</strong> Only when you connect them, and only what they send:</p>
        <ul>
          <li>
            <strong>Google Calendar</strong>, if you connect it: the events on the calendars you pick (title,
            time, location, a link to the event), read only.
          </li>
          <li>
            <strong>Gmail</strong>, if you connect it: only messages you label POS, from the last 30 days
            (sender, subject and text), read only. Nothing is sent back to Gmail.
          </li>
          <li>
            <strong>Bank accounts through SimpleFIN Bridge:</strong> account names, balances and transactions.
            Your bank login stays with SimpleFIN; we never see it.
          </li>
          <li>
            <strong>Apple Health</strong> (through the Health Auto Export app or an Apple Shortcut you set up):
            workouts and the health readings you choose to send, such as weight, heart rate and sleep.
          </li>
          <li>
            <strong>A calendar you subscribe to by URL</strong> (an iCloud calendar you have published, or any
            other calendar with a webcal or https address): the events on it (title, time, location, a link),
            read only. Anyone with that address can read the calendar, so publish only what you are happy to
            share.
          </li>
          <li>
            <strong>Apple Reminders</strong> (through an Apple Shortcut you set up): your open reminders,
            becoming tasks here: title, due date, notes and the list they are in. Nothing is sent back to
            Apple, so finishing a task here does not tick the reminder.
          </li>
          <li><strong>Strava:</strong> your activities, if you connect it.</li>
          <li><strong>A GitHub repository you name:</strong> the notes in it, if you connect a notes vault.</li>
          <li>Web pages and YouTube captions you ask the app to save as notes.</li>
        </ul>
        <p><strong>What is recorded automatically.</strong></p>
        <ul>
          <li>
            A request log: the page or endpoint, the time, the result and how long it took, with a one-way
            hash of your IP address rather than the address itself. It is used to limit abuse and find faults.
          </li>
          <li>Error reports when a page fails: the page, the error and your browser&apos;s user agent string.</li>
          <li>The cookies listed below.</li>
        </ul>
        <p>
          We do not collect your precise location from your device, your contacts, or anything from other
          apps you have not connected.
        </p>
      </Section>

      <Section id="use" title="How we use it">
        <ul>
          <li>To provide the app: store your information, show it back to you, and run the features you use.</li>
          <li>To sign you in and keep your account secure.</li>
          <li>To send the notifications and emails you have turned on, such as the nightly digest.</li>
          <li>To find and fix faults, and to prevent abuse.</li>
          <li>To answer you when you contact us.</li>
          <li>To meet legal obligations and enforce our <Link href="/terms">Terms of Service</Link>.</li>
        </ul>
        <p>
          We do not use your information for advertising, do not sell it, and do not use it to train any AI
          model, ours or anyone else&apos;s.
        </p>
      </Section>

      <Section id="ai" title="Features that use AI">
        <p>
          Some features send the text or files involved to an AI provider to produce a result for you:
          summarizing or transcribing a note or file, reading an insurance document you upload, researching an
          idea, reading a recipe you paste when the app&apos;s own rules cannot, and suggesting which skills an
          item relates to.
          Notes are also turned into search vectors so you can search by meaning. Only what a feature needs is
          sent, when you use it or when the nightly job runs it for you. AI output can be wrong; check it
          before relying on it.
        </p>
        <p>
          Calendar data is never sent to an AI provider, whether it came from Google or from a calendar you
          subscribe to by URL. Gmail messages you label POS are the one exception: the sender, subject and
          the first part of the text are sent to Anthropic, only to draft a task or event proposal for you to
          review. A message with a calendar invite attached is turned into a proposal without being sent. A reminder that becomes a task is a task, and is suggested skills like any
          other task you write here.
        </p>
      </Section>

      <Section id="google" title="Information from Google">
        <p>
          {LEGAL.product}&apos;s use and transfer of information received from Google APIs to any other app will
          adhere to the{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
        <p>
          In practice, if you connect Google Calendar: calendar data from Google is used only to show your events in {LEGAL.product}. It is not
          sold, not used for advertising, not used to train AI models, and not transferred to anyone except as
          needed to run the app (the hosting and database providers below). No person reads it unless you ask
          us to for support, it is needed for security, or the law requires it. You can disconnect Google in
          Settings &gt; Connections, which deletes the token, or revoke access at{' '}
          <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.
        </p>
        <p>
          Gmail is covered by the same rules. Gmail data is used only to draft the task and event proposals,
          and the pending items in a trip&apos;s inbox, that you review before anything is accepted. It is transferred to Anthropic only for that, and to the hosting
          and database providers below to run the app. It is not sold, not used for advertising, not used to
          train AI models, and not read by a person except in the cases above. Gmail data is never written
          back to Gmail.
        </p>
      </Section>

      <Section id="share" title="Who receives it">
        <p>
          These providers process information for us, only to run the app, under their own terms and security
          commitments. They are all in the United States.
        </p>
        <ul>
          <li><strong>Supabase:</strong> the database, sign-in and file storage. Holds everything you store.</li>
          <li><strong>Vercel:</strong> hosting. Every request passes through it.</li>
          <li><strong>Anthropic:</strong> the AI features described above, for the text and files they use.</li>
          <li><strong>Voyage AI:</strong> search vectors for your notes.</li>
          <li><strong>USDA FoodData Central:</strong> the ingredient name you search for in a recipe, to look up its nutrition. Nothing else, and only when you search.</li>
          <li><strong>Resend:</strong> sends email. Receives your address and the email&apos;s content.</li>
          <li>
            <strong>GitHub:</strong> stores the nightly backups of the database in a private repository, and your
            notes vault if you connect one.
          </li>
          <li>
            <strong>Push services</strong> run by your browser&apos;s maker (Apple, Google or Mozilla): carry a
            notification&apos;s title and text to your device, if you turn push on.
          </li>
          <li>
            <strong>Services you connect</strong> (Google, SimpleFIN Bridge, Strava, and whoever publishes a
            calendar you subscribe to by URL): receive the requests needed to fetch your data, under your own
            account with them.
          </li>
        </ul>
        <p>
          We may also disclose information when the law requires it (a valid subpoena or court order), to
          protect someone&apos;s safety, or to defend legal claims. If {LEGAL.product} is ever transferred to
          someone else, this policy goes with it and you will be told first.
        </p>
      </Section>

      <Section id="cookies" title="Cookies">
        <p>
          {LEGAL.product} sets only cookies it needs to work, so there is no cookie banner. There are no
          advertising, analytics or third-party cookies.
        </p>
        <ul>
          <li><strong>Sign-in session</strong> (set by Supabase): keeps you signed in.</li>
          <li><strong>pos_theme</strong>: remembers light or dark, for a year.</li>
          <li><strong>pos_sidebar</strong>: remembers whether the side rail is collapsed, for a year.</li>
          <li>
            <strong>pos_oauth_state_*</strong>: protects a connection to Google or Strava while you approve it;
            expires after 10 minutes.
          </li>
        </ul>
        <p>
          Fonts are served from {LEGAL.product}&apos;s own site; no request goes to Google Fonts or another font
          service.
        </p>
      </Section>

      <Section id="retention" title="How long it is kept">
        <ul>
          <li>Your account and what you store: until you delete it or ask us to delete your account.</li>
          <li>Tokens for a connected service: until you disconnect it.</li>
          <li>The request log: 90 days.</li>
          <li>Error reports: 30 days.</li>
          <li>
            Database backups: 30 days. A deleted item can remain in a backup until that backup expires.
          </li>
          <li>
            Backup copies of files you upload (such as insurance documents): kept until we delete them. When
            you delete your account, or ask us to delete a file, we delete those copies too within 30 days.
          </li>
          <li>Backups are private, reachable only by us, and used only to restore the service after a failure.</li>
        </ul>
      </Section>

      <Section id="rights" title="Your choices and rights">
        <p>Wherever you live, you can:</p>
        <ul>
          <li>see and correct what is stored, in the app;</li>
          <li>get a copy of your information in a machine-readable format;</li>
          <li>delete individual items in the app, or ask us to delete your account and everything in it;</li>
          <li>disconnect any connected service, and turn off any notification or email;</li>
          <li>withdraw consent you have given, without affecting what was done before.</li>
        </ul>
        <p>
          Email <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a> for a copy or a deletion. We confirm
          within 10 days and complete it within 30 days, and may need to confirm the request came from you. We
          will not treat you differently for using these rights. We do not sell or share personal information,
          so there is nothing to opt out of, and an opt-out signal such as Global Privacy Control changes
          nothing because there is no selling or sharing for it to stop. If we decline a
          request you may appeal by replying to our answer, and we will respond within 45 days.
        </p>
      </Section>

      <Section id="security" title="Security">
        <p>
          Connections to {LEGAL.product} are encrypted in transit. Credentials for connected services and
          insurance policy numbers are encrypted again by the app before they are stored. Sign-in uses one-time
          codes or passkeys, with no passwords to leak. No system is perfectly secure; if a breach affects your
          information we will tell you without unreasonable delay and as the law requires.
        </p>
      </Section>

      <Section id="children" title="Children">
        <p>
          {LEGAL.product} is for adults only (see the Terms). It is not directed to children, and we do not
          knowingly collect information from anyone under 18. If you believe a child has used it, email us and
          we will delete the account.
        </p>
      </Section>

      <Section id="where" title="Where it is offered">
        <p>
          {LEGAL.product} is offered only to people in the United States, and information is stored and
          processed in the United States. It is not currently offered in the European Union, the European
          Economic Area, the United Kingdom or Switzerland. Before that changes, this policy will be updated
          with what those laws require.
        </p>
      </Section>

      <Section id="changes" title="Changes to this policy">
        <p>
          If we change this policy in a way that matters, we will tell you by email or in the app at least 30
          days before the change takes effect, unless the law requires a change sooner. The effective date at
          the top always shows the current version.
        </p>
      </Section>

      <Section id="contact" title="Contact">
        <Contact />
      </Section>
    </LegalDoc>
  )
}
