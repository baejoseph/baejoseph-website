import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = await getCollection('blog');
  
  // Filter for Korean posts only (lang === 'ko')
  const koPosts = posts.filter(post => post.data.lang === 'ko');
  
  // Sort by date descending
  const sortedPosts = koPosts.sort((a, b) => {
    return new Date(b.data.date).getTime() - new Date(a.data.date).getTime();
  });

  return rss({
    title: 'Joseph Bae — 신앙 · 문화 · 삶 (한국어)',
    description: '신앙, 문화, 정치, 삶의 여정을 탐구하는 개인 블로그. 마라나타! 🕦️',
    site: context.site ?? 'https://baejoseph.com',
    items: sortedPosts.map(post => ({
      title: `${post.data.title}`,
      pubDate: new Date(post.data.date).getTime(),
      description: post.body?.slice(0, 200) || '',
      link: `/${post.slug}/`,
      enclosure: post.data.featuredImage ? {
        url: `https://baejoseph.com${post.data.featuredImage}`,
        type: 'image/png'
      } : undefined
    })),
    customData: `<generator>Astro RSS</generator>`
  });
}
