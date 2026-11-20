import Image from 'next/image';

// The left campus-photo panel shared by the password sign-in page and the Clerk sign-in page, so both look identical.
// On phones and tablets it becomes a banner; the headline card is desktop only. The photo math keeps the PUP pylon centered.
export default function AuthBrandPanel() {
  return (
    <section
      aria-label="About CCCMS"
      className="relative isolate flex h-64 w-full shrink-0 flex-col justify-end overflow-hidden bg-[#3D0606] p-5 sm:h-80 sm:p-8 md:h-[22rem] lg:h-auto lg:min-h-[100dvh] lg:w-1/2 lg:p-10 lg:pb-11"
    >
      {/*
        The photo is placed so the PUP pylon sits in the horizontal middle of the panel at any size.
        The pylon is at 64.7% across the 1538x1022 photo, its pillars span 25%-85% down it. Inside this
        box (a size container, so cqw/cqh are the panel's own width/height) the photo is drawn at
        width S = the larger of (--hf x the height-fitting width) and (--zoom x the panel width), then
        shifted left so the pylon lands at 50%, never leaving a gap at an edge. Phones and tablets
        zoom in (--zoom) because a wide banner could not otherwise center it; desktop draws the photo
        20% taller than the panel (--hf) and lets it sit low, so the pillars end just above the card.
      */}
      <div
        className="absolute inset-0 -z-20 overflow-hidden [container-type:size] [--hf:1.2] [--vc:0.56] [--zoom:1.45] sm:[--vc:0.42] lg:[--vc:0.6] lg:[--zoom:1]"
        aria-hidden="true"
      >
        <Image
          src="/Background.png"
          alt=""
          width={1538}
          height={1022}
          priority
          sizes="(min-width: 1024px) 100vw, 150vw"
          className="absolute max-w-none"
          style={{
            '--s': 'max(calc(var(--hf) * 150.49cqh), calc(var(--zoom) * 100cqw))',
            width: 'var(--s)',
            height: 'calc(var(--s) / 1.5049)',
            left: 'clamp(100cqw - var(--s), 50cqw - 0.6473 * var(--s), 0px)',
            top: 'clamp(100cqh - var(--s) / 1.5049, 50cqh - var(--vc) * var(--s) / 1.5049, 0px)',
          }}
        />
      </div>
      {/* Light wash at the top for the logo, darker toward the bottom for the headline card */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[#2A0404]/70 via-[#2A0404]/0 to-[#2A0404]/45" aria-hidden="true" />

      <div className="mx-auto hidden w-[88%] max-w-[660px] rounded-xl border border-white/10 bg-[#520909]/90 p-5 shadow-xl backdrop-blur-sm lg:block xl:w-[80%] xl:px-7 xl:py-6">
        <div className="mb-3 h-[3px] w-10 rounded-full bg-[#E5B52B] xl:mb-4 xl:w-12" />
        <h1 className="font-serif text-[24px] font-normal leading-[1.15] tracking-tight text-white text-balance xl:text-[30px]">
          <span className="block">Citizen&apos;s Charter</span>
          <span className="block">Compliance&nbsp;/ Monitoring System</span>
        </h1>
        <p className="mt-2 text-[13px] leading-snug text-white/85 text-pretty xl:text-[15px]">
          Monitor how each office keeps the promises in the Citizen&apos;s Charter.
        </p>
      </div>
    </section>
  );
}
