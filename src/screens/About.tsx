import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { Header } from '../components/Header'
import { LondonHomesAnimation } from '../components/LondonHomesAnimation'
import teamPhoto from '../assets/team-photo.jpg'

const STEPS = [
  {
    title: 'Upload a floor plan and photos',
    body: 'A PDF or image of the plan, plus a few photos of each room, and the address if you like. Phone photos are fine.',
  },
  {
    title: 'AI reads the plan and sorts the photos',
    body: 'A vision model finds every room on the plan, including unlabelled bathrooms and halls, measures it, and works out which room each photo shows. If it is unsure, it asks you.',
  },
  {
    title: 'Each room is rebuilt in 3D',
    body: 'MASt3R, a 3D reconstruction model, turns the photos of each room into a coloured 3D scan, which we place on the plan at its real size.',
  },
  {
    title: 'Explore it',
    body: 'Orbit around the whole home, click a room to see its photos, open a 360° view, or download the model as a .glb file.',
  },
  {
    title: 'Walk through it',
    body: 'Walk from room to room, furnished in the colours from your photos. Open any photo in 3D, look out of the windows, step out to the street, or redesign a room and let AI show how it would really look.',
  },
]

const TEAM = [
  { name: 'Neev Dhall', linkedin: 'https://www.linkedin.com/in/neev-dhall/' },
  { name: 'William Robinson', linkedin: 'https://www.linkedin.com/in/williamh-robinson/' },
  { name: 'Jessica Wei', linkedin: 'https://www.linkedin.com/in/jessica-w-a74a79179/' },
]

const CREDITS = [
  { name: 'MASt3R', by: 'Naver Labs Europe', note: 'room reconstruction · CC BY-NC-SA 4.0', href: 'https://github.com/naver/mast3r' },
  { name: 'Gemini', by: 'Google', note: 'reading floor plans, matching photos and furnishing rooms', href: 'https://ai.google.dev' },
  { name: 'HunyuanWorld via fal', by: 'Tencent / fal.ai', note: '360° room impressions', href: 'https://fal.ai' },
  { name: 'Gemini image generation (Nano Banana)', by: 'Google', note: 'Reimagine: photo-real redesigns', href: 'https://ai.google.dev' },
  { name: 'MoGe-2 via fal', by: 'Microsoft / fal.ai', note: '3D photos (Depth Anything as backup)', href: 'https://github.com/microsoft/MoGe' },
  { name: 'Google Maps Platform', by: 'Google', note: 'Street View and the view from the windows', href: 'https://developers.google.com/maps' },
  { name: 'three.js', by: 'three.js authors', note: '3D viewer and walk-through', href: 'https://threejs.org' },
  { name: 'Marzipano', by: 'Google', note: '360° viewer', href: 'https://www.marzipano.net' },
  { name: 'Modal, Netlify and Vercel', by: '', note: 'GPU backend and hosting', href: '' },
]

export function About() {
  return (
    <>
      <Header />
      <main className="page about">
        <h1 className="page-title">About Veduta</h1>
        <p className="about-lead">
          Veduta turns a floor plan and a handful of room photos into a 3D model of a home that you can look around and redesign from
          any device. No 3D scanner, no special camera, no modelling skills.
        </p>

        <LondonHomesAnimation />

        <section aria-labelledby="why">
          <h2 id="why">Why?</h2>
          <p>
            Listing photos show what a room looks like but not how the home fits together. Floor plans show the layout but
            not what it feels like to be there. Veduta puts the two together, so buyers, renters and anyone planning a move
            can understand a place before they visit it.
          </p>
        </section>

        <section aria-labelledby="how">
          <h2 id="how">How it works</h2>
          <ol className="about-steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="about-num">{i + 1}</span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="limits">
          <h2 id="limits">Good to know</h2>
          <ul className="about-list">
            <li>The 3D model is only as good as the photos. Rooms with no photos get plain floors and walls.</li>
            <li>
              The 360° views are <strong>AI-generated impressions</strong>. They are built from a single photo, so most of
              each view is invented and won&rsquo;t match the real room exactly.
            </li>
            <li>
              The walk-through&rsquo;s furniture and the Reimagine pictures are impressions too: the AI picks furniture and
              colours to match what it sees in your photos, not the exact pieces.
            </li>
            <li>
              Veduta is a hackathon prototype. Uploads are processed by third-party AI services, so please don&rsquo;t
              upload photos of a home without the owner&rsquo;s permission, or anything private.
            </li>
          </ul>
        </section>

        <section aria-labelledby="team">
          <h2 id="team">Who made it</h2>
          <p>
            Originally built by{' '}
            {TEAM.map((m, i) => (
              <Fragment key={m.name}>
                {i > 0 && (i === TEAM.length - 1 ? ' and ' : ', ')}
                <a href={m.linkedin} target="_blank" rel="noreferrer" title={`${m.name} on LinkedIn`}>
                  {m.name}
                </a>
              </Fragment>
            ))}{' '}
            at Imperial AI Hack 2026.
          </p>
          <p>
            The name comes from the Italian <em>veduta</em>, &ldquo;view&rdquo;: the detailed, true-to-life paintings of real
            places made by artists like Canaletto.
          </p>
          <figure className="team-photo">
            <img
              src={teamPhoto}
              alt="The Veduta team at Imperial AI Hack 2026"
              width={1240}
              height={930}
              loading="lazy"
            />
          </figure>
        </section>

        <section aria-labelledby="credits">
          <h2 id="credits">Built with</h2>
          <ul className="about-credits">
            {CREDITS.map((c) => (
              <li key={c.name}>
                {c.href ? <a href={c.href} target="_blank" rel="noreferrer">{c.name}</a> : <span>{c.name}</span>}
                {c.by && <span className="about-by"> by {c.by}</span>}
                <span className="about-note"> · {c.note}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="about-ctas">
          <Link to="/" className="btn btn-primary btn-lg">
            Try it
          </Link>
          <Link to="/demo" className="btn btn-lg">
            See the demo
          </Link>
        </div>
      </main>
    </>
  )
}
