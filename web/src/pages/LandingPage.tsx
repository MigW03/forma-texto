import Hero from '../components/sections/Hero'
import Services from '../components/sections/Services'
import Pricing from '../components/sections/Pricing'
import Footer from '../components/layout/Footer'

export default function LandingPage() {
  return (
    <>
      <main>
        <Hero />
        <Services />
        <Pricing />
      </main>
      <Footer />
    </>
  )
}
