/** Встраивается целиком в installed consumer; зависимости приходят из public exports. */
export function verifyInstalledAuthorVariation({ icon, variant, expected, familyVariation, current, capabilities, symbol, variable, lottie, compileSymbolEffect }) {
  const require = (condition, message) => { if (!condition) throw new Error(`${message}: ${icon}/${variant}`); };
  const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const refuses = (glyph, request, code) => {
    try { glyph(request); } catch (error) { return error.code === code; }
    return false;
  };
  if (expected.variation) {
    const policy = expected.variation;
    let defaults, nondefault, outsideDomain, foreign;
    if (policy.law === 'dots.affine') {
      defaults = { dotScale: 1, spacingScale: 1 };
      nondefault = { dotScale: 1.1, spacingScale: 0.9 };
      outsideDomain = { dotScale: 3, spacingScale: 0.5 };
      foreign = { enclosureEmphasis: 1.1 };
    } else if (policy.law === 'annulus.counter-scale') {
      defaults = { enclosureEmphasis: 1 };
      nondefault = policy.nondefault;
      outsideDomain = policy.outsideDomain;
      foreign = { dotScale: 1.1 };
      require(variant === 'outline' && nondefault?.enclosureEmphasis !== 1, 'authored annulus missing nondefault witness');
    } else if (policy.law === 'capsule.width') {
      defaults = { bodyWidth: 1 }; nondefault = policy.nondefault; outsideDomain = policy.outsideDomain;
      foreign = { dotScale: 1.1 };
      require(nondefault?.bodyWidth > policy.domain.minimum && nondefault.bodyWidth < 1, 'authored body missing nondefault witness');
    } else {
      throw new Error(`unsupported authored variation law: ${policy.law}: ${icon}/${variant}`);
    }
    const variableCapabilities = variable.glyphCapabilities(variant);
    require(variable.glyph({ variant }) === current && variableCapabilities.author === capabilities.author &&
      variableCapabilities.anatomy === capabilities.anatomy, 'opt-in variation duplicated authored source');
    require(variableCapabilities.variation?.law === policy.law && variableCapabilities.variation.geometrySha256 === policy.geometrySha256 &&
      equal(variableCapabilities.variation.domain, policy.domain) && equal(variableCapabilities.variation.defaults, defaults),
    'current authored variation policy differs');
    require(variable.glyph({ variant, variation: defaults }) === current, 'authored variation identity roundtripped');
    const varied = variable.glyph({ variant, variation: nondefault });
    require(varied.provenance.kind === 'authored-variation' && varied.d !== current.d && varied.svg !== current.svg &&
      varied.provenance.variation.law === policy.law && varied.provenance.variation.geometrySha256 === policy.geometrySha256 &&
      equal(varied.provenance.variation.parameters, nondefault) && equal(varied.provenance.author, expected.author) &&
      equal(varied.provenance.anatomy, current.provenance.anatomy), 'authored variation not materialized');
    const identities = parts => parts.map(part => [part.id, part.fillRule, part.topologySignature, part.zIndex, part.role]);
    require(equal(identities(varied.parts), identities(current.parts)) &&
      varied.parts.every(part => varied.svg.includes('d="' + part.d + '"')), 'authored variation lost parts/SVG');
    if (policy.law === 'dots.affine') {
      require(varied.parts.every((part, index) => part.d !== current.parts[index].d), 'authored variation changed-part contract');
    } else if (policy.law === 'capsule.width') {
      const bodyIndex = current.parts.findIndex(part => part.id === policy.bodyPartId);
      require(bodyIndex >= 0 && current.parts[bodyIndex].role === 'content' &&
        varied.parts.every((part, index) => index === bodyIndex
          ? part.d !== current.parts[index].d && equal(part.anchor, current.parts[index].anchor)
          : part === current.parts[index]), 'authored variation changed-part contract');
    } else {
      const enclosureIndex = current.parts.findIndex(part => part.id === policy.enclosurePartId);
      require(enclosureIndex >= 0 && current.parts[enclosureIndex].role === 'container' &&
        varied.parts.every((part, index) => index === enclosureIndex
          ? part.d !== current.parts[index].d && part.d.startsWith(policy.enclosureOuterD) &&
            equal(part.anchor, current.parts[index].anchor) && part.anchorSource === current.parts[index].anchorSource
          : part === current.parts[index]), 'authored variation changed-part contract');
    }
    for (const [gesture] of Object.entries(expected.effects)) require(
      compileSymbolEffect(varied, variableCapabilities, gesture, { duration: 360 }).ok, 'authored variation lost declared gesture');
    require(refuses(variable.glyph, { variant, variation: outsideDomain }, 'VARIATION_OUTSIDE_DOMAIN'),
      'authored variation admitted outside-domain controls');
    require(refuses(variable.glyph, { variant, variation: foreign }, 'INVALID_VARIATION'), 'authored variation admitted foreign-law parameters');
    require(refuses(variable.glyph, { variant, modelMode: 'source-only', variation: nondefault }, 'AUTHOR_PARITY_REQUIRED'),
      'authored variation changed source-only master');
    require(refuses(symbol.glyph, { variant, variation: nondefault }, 'AUTHOR_VARIATION_UNSUPPORTED'),
      'ordinary source symbol accepted opt-in variation');
    const refusedTarget = lottie.exportLottie({ variant, variation: nondefault });
    require(!refusedTarget.ok && refusedTarget.reason.code === 'VARIATION_UNSUPPORTED',
      'Lottie silently exported default geometry for variation');
  } else {
    require(refuses(symbol.glyph, { variant, variation: { dotScale: 1.1 } }, 'AUTHOR_VARIATION_UNSUPPORTED'),
      'undeclared authored geometry variation accepted');
    if (familyVariation) {
      let variation;
      if (familyVariation.law === 'annulus.counter-scale') variation = familyVariation.nondefault;
      else if (familyVariation.law === 'dots.affine') variation = { dotScale: 1.1, spacingScale: 0.9 };
      else if (familyVariation.law === 'capsule.width') variation = familyVariation.nondefault;
      else throw new Error(`unsupported authored variation law: ${familyVariation.law}: ${icon}/${variant}`);
      require(variable.glyph({ variant }) === current, 'unsupported authored variation default differs');
      const variableCapabilities = variable.glyphCapabilities(variant);
      require(variableCapabilities === capabilities && !Object.hasOwn(variableCapabilities, 'variation'),
        'unsupported authored variation capabilities differ');
      require(refuses(variable.glyph, { variant, variation }, 'AUTHOR_VARIATION_UNSUPPORTED'),
        'unsupported authored variation accepted');
      require(refuses(symbol.glyph, { variant, variation }, 'AUTHOR_VARIATION_UNSUPPORTED'),
        'ordinary source symbol accepted opt-in variation');
    }
  }
}

export function authorVariationArtifactConsumerSource() {
  return `const verifyInstalledAuthorVariation = ${verifyInstalledAuthorVariation.toString()};\n`;
}

/** Одна family-level граница импорта используется полным smoke и узким consumer. */
export function authorVariationFamilyConsumerSource() {
  return `const familyVariation = Object.values(variants).find(expected => expected.variation)?.variation ?? null;\n` +
    `const variable = familyVariation ? await import('@labpics/icons/variations/' + icon) : null;\n` +
    `const lottieVariation = familyVariation ? await import('@labpics/icons/lottie/' + icon) : null;\n`;
}
