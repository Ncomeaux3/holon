import type { Metadata } from 'next'
import Link from 'next/link'
import { LEGAL } from '@/core/legal'
import { Contact, LegalDoc, Section } from '../../doc'

export const metadata: Metadata = { title: 'Consumer health data privacy policy · Holon' }

// Washington's My Health My Data Act asks for this as its own policy, linked
// from the homepage, apart from the general one. Nevada and Connecticut have
// similar rules; this page is written to satisfy all three.

export default function HealthPrivacyPage() {
  return (
    <LegalDoc
      title="Consumer health data privacy policy"
      lede={
        <p>
          This policy covers the health information {LEGAL.product} holds, under Washington&apos;s My Health
          My Data Act, Nevada&apos;s consumer health data law, Connecticut&apos;s rules on consumer health data,
          and similar laws. It adds to the <Link href="/privacy">Privacy Policy</Link>, which covers everything
          else. {LEGAL.product} is not a medical provider, and this information is not covered by HIPAA.
        </p>
      }
    >
      <Section id="what" title="Health information we collect">
        <ul>
          <li>
            What you enter in the Health and Fitness parts of the app: health records, vitals, medications and
            refill dates, screenings, appointments, workouts, training plans and body measurements.
          </li>
          <li>
            What you choose to send from Apple Health through the Health Auto Export app or an Apple Shortcut:
            workouts and readings such as weight, heart rate, sleep and steps.
          </li>
          <li>Workouts from Strava, if you connect it.</li>
          <li>Health-type insurance policies you add, and their documents.</li>
          <li>
            Anything health related you write elsewhere in the app, such as in a note or a task, which we treat
            the same way.
          </li>
        </ul>
        <p>We do not collect precise location to infer visits to a health care provider, and do not use geofencing.</p>
      </Section>

      <Section id="why" title="Why we collect it">
        <p>
          Only to provide the features you use: to store it, show it back to you in charts, calendars and
          reminders, include it in your own digest, and link it to your goals and skills. We do not use it for
          advertising, do not sell it, do not use it to train AI models, and do not use it for any purpose you
          have not asked for.
        </p>
      </Section>

      <Section id="consent" title="Your consent">
        <p>
          We collect health information only as needed to provide the service you asked for, or with your
          separate consent. Nothing arrives from Apple Health or Strava unless you set up the connection
          yourself, and you can stop it at any time by removing the automation or disconnecting the service.
          You can withdraw consent at any time by emailing us, and we will stop collecting and delete what we
          hold.
        </p>
      </Section>

      <Section id="sources" title="Where it comes from">
        <p>From you, from Apple Health on your own devices when you send it, and from Strava if you connect it.</p>
      </Section>

      <Section id="share" title="Who receives it">
        <p>
          We do not sell health information and do not share it with anyone except the service providers that
          run the app for us, only as needed to run it:
        </p>
        <ul>
          <li>Supabase (database and file storage) and Vercel (hosting), which process everything the app holds;</li>
          <li>GitHub, which stores private backups of the database;</li>
          <li>Resend, which sends your digest email if it mentions a health item;</li>
          <li>
            Anthropic, only when you use an AI feature on something that contains health information, such as
            asking the app to read a health insurance document.
          </li>
        </ul>
        <p>
          We would share health information with anyone else only with your separate, signed authorization, or
          where the law requires it.
        </p>
      </Section>

      <Section id="rights" title="Your rights">
        <ul>
          <li>Confirm whether we hold your health information, and see it.</li>
          <li>Get a list of every third party and affiliate we have shared it with, and how to contact them.</li>
          <li>Delete it, including its backup copies within 30 days, and have us tell our providers to delete it.</li>
          <li>Withdraw your consent.</li>
        </ul>
        <p>
          Email <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a> with the subject &quot;Health data
          request&quot;. We answer within 45 days, and may extend once by 45 days when needed, telling you why.
          If we decline, you can appeal by replying; we answer an appeal within 45 days and, if we still
          decline, tell you how to contact your state Attorney General. There is no charge for up to two
          requests a year.
        </p>
      </Section>

      <Section id="contact" title="Contact">
        <Contact />
      </Section>
    </LegalDoc>
  )
}
