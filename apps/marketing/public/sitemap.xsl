<?xml version="1.0" encoding="UTF-8"?>
<!--
  Shows /sitemap.xml as a readable page in a browser. Search engines ignore this and read the XML.
  Colours are the site's design tokens (src/app/globals.css), copied because this page can't load
  the site's CSS.
-->
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9"
  exclude-result-prefixes="s">
  <xsl:output method="html" encoding="UTF-8" indent="yes" doctype-system="about:legacy-compat"/>

  <!-- The page's path without the site's address: "" for Home, "guides/x" for a guide. -->
  <xsl:template name="path">
    <xsl:param name="loc"/>
    <xsl:value-of select="substring-after(substring-after($loc, '://'), '/')"/>
  </xsl:template>

  <xsl:template name="section">
    <xsl:param name="title"/>
    <xsl:param name="hint"/>
    <xsl:param name="urls"/>
    <xsl:param name="wide" select="false()"/>
    <xsl:if test="count($urls) &gt; 0">
      <section class="card">
        <xsl:if test="$wide"><xsl:attribute name="class">card wide</xsl:attribute></xsl:if>
        <header>
          <h2><xsl:value-of select="$title"/></h2>
          <span class="count"><xsl:value-of select="count($urls)"/></span>
        </header>
        <p class="hint"><xsl:value-of select="$hint"/></p>
        <ul>
          <xsl:for-each select="$urls">
            <xsl:variable name="path">
              <xsl:call-template name="path"><xsl:with-param name="loc" select="s:loc"/></xsl:call-template>
            </xsl:variable>
            <li>
              <a href="{s:loc}">
                <span class="page">
                  <xsl:choose>
                    <xsl:when test="$path = ''">Home</xsl:when>
                    <xsl:otherwise>/<xsl:value-of select="$path"/></xsl:otherwise>
                  </xsl:choose>
                </span>
                <span class="url"><xsl:value-of select="s:loc"/></span>
              </a>
            </li>
          </xsl:for-each>
        </ul>
      </section>
    </xsl:if>
  </xsl:template>

  <xsl:template match="/">
    <xsl:variable name="all" select="s:urlset/s:url"/>
    <html lang="en">
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <meta name="robots" content="noindex"/>
        <title>Sitemap · Bookalyze</title>
        <link rel="icon" href="/favicon-light.svg" type="image/svg+xml"/>
        <style>
          :root {
            color-scheme: light dark;
            --background: oklch(0.99 0.002 286);
            --foreground: oklch(0.2 0.02 280);
            --card: oklch(1 0 0);
            --primary: oklch(0.51 0.18 275);
            --muted: oklch(0.965 0.006 286);
            --muted-foreground: oklch(0.53 0.02 280);
            --border: oklch(0.925 0.006 286);
            --ring: oklch(0.6 0.16 275);
          }
          @media (prefers-color-scheme: dark) {
            :root {
              --background: oklch(0.17 0.012 280);
              --foreground: oklch(0.96 0.005 286);
              --card: oklch(0.205 0.014 280);
              --primary: oklch(0.68 0.15 275);
              --muted: oklch(0.26 0.014 280);
              --muted-foreground: oklch(0.7 0.015 280);
              --border: oklch(0.29 0.014 280);
              --ring: oklch(0.68 0.15 275);
            }
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            background: var(--background);
            color: var(--foreground);
            font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
            -webkit-font-smoothing: antialiased;
          }
          main { max-width: 56rem; margin-inline: auto; padding: 2.5rem 1rem 4rem; }
          .brand { display: inline-block; height: 1.75rem; }
          .brand img { height: 100%; width: auto; }
          .logo-dark { display: none; }
          @media (prefers-color-scheme: dark) {
            .logo-light { display: none; }
            .logo-dark { display: inline; }
          }
          .eyebrow {
            margin: 2.5rem 0 0.25rem;
            color: var(--primary);
            font-size: 0.8125rem;
            font-weight: 600;
            letter-spacing: 0.04em;
            text-transform: uppercase;
          }
          h1 { margin: 0; font-size: 2rem; line-height: 1.2; letter-spacing: -0.02em; }
          .lead { margin: 0.75rem 0 2rem; max-width: 40rem; color: var(--muted-foreground); }
          .grid { display: grid; gap: 1rem; }
          @media (min-width: 48rem) {
            .grid { grid-template-columns: 1fr 1fr; }
            .wide { grid-column: 1 / -1; }
            .wide ul { columns: 2; column-gap: 2rem; }
          }
          .card {
            background: var(--card);
            border: 1px solid var(--border);
            border-radius: 1rem;
            padding: 1.25rem;
            box-shadow: 0 1px 2px oklch(0 0 0 / 0.04);
            animation: enter 0.3s ease-out both;
          }
          @keyframes enter { from { opacity: 0; transform: translateY(4px); } }
          @media (prefers-reduced-motion: reduce) { .card { animation: none; } }
          .card header { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }
          h2 { margin: 0; font-size: 1rem; }
          .count {
            min-width: 1.75rem;
            padding: 0.125rem 0.5rem;
            border-radius: 999px;
            background: var(--muted);
            color: var(--muted-foreground);
            font-size: 0.75rem;
            font-weight: 600;
            text-align: center;
            font-variant-numeric: tabular-nums;
          }
          .hint { margin: 0.25rem 0 0.75rem; color: var(--muted-foreground); font-size: 0.8125rem; }
          ul { list-style: none; margin: 0; padding: 0; }
          li { break-inside: avoid; border-top: 1px solid var(--border); }
          li:first-child { border-top: 0; }
          li a {
            display: grid;
            gap: 0.125rem;
            padding: 0.625rem 0.5rem;
            margin-inline: -0.5rem;
            border-radius: 0.5rem;
            color: inherit;
            text-decoration: none;
          }
          li a:hover { background: var(--muted); }
          li a:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }
          .page { font-weight: 500; overflow-wrap: anywhere; }
          li a:hover .page { color: var(--primary); }
          .url { color: var(--muted-foreground); font-size: 0.75rem; overflow-wrap: anywhere; }
          footer { margin-top: 2.5rem; color: var(--muted-foreground); font-size: 0.8125rem; }
          footer a { color: var(--primary); font-weight: 500; text-underline-offset: 4px; }
        </style>
      </head>
      <body>
        <main>
          <a class="brand" href="/" aria-label="Bookalyze home">
            <img class="logo-light" src="/brand/logo-light.svg" alt="Bookalyze"/>
            <img class="logo-dark" src="/brand/logo-dark.svg" alt="Bookalyze"/>
          </a>
          <p class="eyebrow">Sitemap</p>
          <h1>Every page on the site</h1>
          <p class="lead">
            This is the list search engines use to find Bookalyze's pages: <xsl:value-of select="count($all)"/>
            pages in all. Click any of them to open it.
          </p>

          <div class="grid">
            <xsl:call-template name="section">
              <xsl:with-param name="title">Main pages</xsl:with-param>
              <xsl:with-param name="hint">What Bookalyze is, what it costs, and how to reach us.</xsl:with-param>
              <xsl:with-param name="urls" select="$all[not(contains(substring-after(substring-after(s:loc, '://'), '/'), '/'))]"/>
            </xsl:call-template>
            <xsl:call-template name="section">
              <xsl:with-param name="title">Features</xsl:with-param>
              <xsl:with-param name="hint">One page for each part of Bookalyze, and what it does.</xsl:with-param>
              <xsl:with-param name="urls" select="$all[starts-with(substring-after(substring-after(s:loc, '://'), '/'), 'features/')]"/>
            </xsl:call-template>
            <xsl:call-template name="section">
              <xsl:with-param name="title">Marketplaces</xsl:with-param>
              <xsl:with-param name="hint">One page for each marketplace Bookalyze connects to.</xsl:with-param>
              <xsl:with-param name="urls" select="$all[starts-with(substring-after(substring-after(s:loc, '://'), '/'), 'marketplaces/')]"/>
            </xsl:call-template>
            <xsl:call-template name="section">
              <xsl:with-param name="title">Sellers by country</xsl:with-param>
              <xsl:with-param name="hint">How Bookalyze works for sellers based in each country.</xsl:with-param>
              <xsl:with-param name="urls" select="$all[starts-with(substring-after(substring-after(s:loc, '://'), '/'), 'sellers/')]"/>
            </xsl:call-template>
            <xsl:call-template name="section">
              <xsl:with-param name="title">Guides</xsl:with-param>
              <xsl:with-param name="hint">Step-by-step help with bookkeeping for online sellers.</xsl:with-param>
              <xsl:with-param name="urls" select="$all[starts-with(substring-after(substring-after(s:loc, '://'), '/'), 'guides/')]"/>
              <xsl:with-param name="wide" select="true()"/>
            </xsl:call-template>
          </div>

          <footer>
            <a href="/">Back to bookalyze.com</a>
          </footer>
        </main>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
