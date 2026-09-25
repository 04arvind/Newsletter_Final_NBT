// import { Section, Row, Column, Heading, Text, Link, Hr } from "@react-email/components"

// interface ArticleCardProps {
//   title: string
//   summary: string
//   url: string
//   source?: string
// }

// export function ArticleCard({ title, summary, url, source }: ArticleCardProps) {
//   return (
//     <Section style={{ padding: '20px 0', borderBottom: '1px solid #eee' }}>
//       <Row>
//         <Column>
//           <Link href={url} style={{ textDecoration: 'none', color: '#111' }}>
//             <Heading as="h2" style={{ fontSize: '18px', margin: '0 0 8px' }}>
//               {title}
//             </Heading>
//           </Link>
//           <Text style={{ fontSize: '14px', color: '#444', margin: '0 0 8px', lineHeight: '1.5' }}>
//             {summary}
//           </Text>
//           <Link
//             href={url}
//             style={{ fontSize: '13px', fontWeight: 600, color: '#d64545' }}
//           >
//             Read the full story →
//           </Link>
//           {source && (
//             <Text style={{ fontSize: '11px', color: '#999', marginTop: '6px' }}>
//               {source}
//             </Text>
//           )}
//         </Column>
//       </Row>
//     </Section>
//   )
// }