/**
 * Podcast RSS 2.0 feed with the iTunes namespace, accepted by Apple Podcasts,
 * Spotify, Google/YouTube Music and every podcast app.
 */

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const cdata = (value) => `<![CDATA[${String(value ?? '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

function duration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * @param {object} church Church doc (name, podcast settings)
 * @param {object[]} episodes Published sermons joined with their audio file
 * @param {{feedUrl: string, siteUrl: string}} urls
 */
export function buildPodcastFeed(church, episodes, urls) {
  const p = church.podcast || {};
  const title = p.title || church.name;
  const author = p.author || church.name;
  const description = p.description || `Sermons and teachings from ${church.name}.`;
  const language = p.language || 'en';
  const category = p.category || 'Religion & Spirituality';
  const subcategory = p.subcategory || 'Christianity';

  const items = episodes
    .map((e) => {
      const summary = [e.description, e.summary?.summary].filter(Boolean).join('\n\n') || e.title;
      const extra = [
        e.preacher && `Preacher: ${e.preacher}`,
        e.scripture && `Scripture: ${e.scripture}`,
        e.series && `Series: ${e.series}`,
      ].filter(Boolean).join('\n');
      const chapters = (e.summary?.chapters || []).map((c) => `${duration(c.start)} ${c.title}`).join('\n');
      const body = [summary, extra, chapters && `Chapters:\n${chapters}`].filter(Boolean).join('\n\n');
      return `    <item>
      <title>${esc(e.title)}</title>
      <description>${cdata(body)}</description>
      <itunes:summary>${cdata(summary)}</itunes:summary>
      ${e.preacher ? `<itunes:author>${esc(e.preacher)}</itunes:author>` : ''}
      <enclosure url="${esc(e.audioUrl)}" length="${Number(e.audioBytes) || 0}" type="audio/mpeg"/>
      <guid isPermaLink="false">${esc(e.id)}</guid>
      <pubDate>${new Date(e.pubDate).toUTCString()}</pubDate>
      <itunes:duration>${duration(e.durationSeconds)}</itunes:duration>
      <itunes:explicit>false</itunes:explicit>
      <itunes:episodeType>full</itunes:episodeType>
    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${esc(title)}</title>
    <link>${esc(urls.siteUrl)}</link>
    <atom:link href="${esc(urls.feedUrl)}" rel="self" type="application/rss+xml"/>
    <description>${cdata(description)}</description>
    <language>${esc(language)}</language>
    <copyright>${esc(`© ${new Date().getFullYear()} ${church.name}`)}</copyright>
    <itunes:author>${esc(author)}</itunes:author>
    <itunes:summary>${cdata(description)}</itunes:summary>
    <itunes:type>episodic</itunes:type>
    <itunes:explicit>false</itunes:explicit>
    ${p.artworkUrl ? `<itunes:image href="${esc(p.artworkUrl)}"/>\n    <image><url>${esc(p.artworkUrl)}</url><title>${esc(title)}</title><link>${esc(urls.siteUrl)}</link></image>` : ''}
    <itunes:category text="${esc(category)}">${subcategory ? `<itunes:category text="${esc(subcategory)}"/>` : ''}</itunes:category>
    ${p.email ? `<itunes:owner><itunes:name>${esc(author)}</itunes:name><itunes:email>${esc(p.email)}</itunes:email></itunes:owner>` : ''}
${items}
  </channel>
</rss>
`;
}
