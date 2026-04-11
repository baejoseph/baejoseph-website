import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const posts = await getCollection('blog');
  
  // Filter for English posts only (lang !== 'ko')
  const englishPosts = posts.filter(post => post.data.lang !== 'ko');
  
  // Sort by date descending
  const sortedPosts = englishPosts.sort((a, b) => {
    return new Date(b.data.date).getTime() - new Date(a.data.date).getTime();
  });

  return rss({
    title: 'Joseph Bae — Faith · Culture · Life',
    description: 'A personal blog exploring faith, culture, politics, and life journey. Maranatha! 🕦️',
    site: context.site ?? 'https://baejoseph.com',
    items: sortedPosts.map(post => ({
      title: post.data.title,
      pubDate: new Date(post.data.date),
      description: post.body?.slice(0, 200) || post.data.title,
      link: `/${post.slug}/`
    })),
    customData: `<generator>Astro RSS</generator>`
  });
}
