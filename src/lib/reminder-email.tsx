import {
  Body, Button, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from 'react-email';
import { formatDueDate } from '@/lib/dates';
import { digestSummary, dueInLabel, type DigestData, type ReminderData } from '@/lib/reminders';

// Align light tokens as hex (email clients do not understand oklch or CSS
// variables); same values as the auth emails in email.tsx.
const c = {
  background: '#F7F7F7', card: '#FFFFFF', border: '#EBEBEB', foreground: '#262626',
  muted: '#5C5C5C', primary: '#335CFF', primaryForeground: '#FFFFFF',
};

const body = { backgroundColor: c.background, fontFamily: 'Inter, Helvetica, Arial, sans-serif', margin: 0, padding: '24px 0' };
const card = { backgroundColor: c.card, border: `1px solid ${c.border}`, borderRadius: 16, margin: '0 auto', maxWidth: 480, padding: 24 };
const heading = { color: c.foreground, fontSize: 18, fontWeight: 600, margin: '0 0 8px' };
const text = { color: c.muted, fontSize: 14, lineHeight: '20px', margin: '0 0 8px' };
const button = {
  backgroundColor: c.primary, borderRadius: 10, color: c.primaryForeground, display: 'inline-block',
  fontSize: 14, fontWeight: 500, padding: '10px 16px', textDecoration: 'none',
};

// Dates in the email are relative to the due date itself; 'UTC' keeps the
// bare YYYY-MM-DD from shifting while it is formatted.
const dateLabel = (day: string) => formatDueDate(day, 'UTC', new Date(Date.UTC(1970, 0, 1)));

export function ReminderEmail({ data, url }: { data: ReminderData; url: string }) {
  return (
    <Html>
      <Head />
      <Preview>{`${data.title} is due ${dueInLabel(data.daysLeft)}`}</Preview>
      <Body style={body}>
        <Container style={card}>
          <Heading style={heading}>{data.title}</Heading>
          <Text style={text}>
            {data.projectName} · due {dueInLabel(data.daysLeft)} ({dateLabel(data.dueDate)})
          </Text>
          <Section style={{ marginTop: 16 }}>
            <Button href={url} style={button}>Open task</Button>
          </Section>
          <Hr style={{ borderColor: c.border, margin: '24px 0 12px' }} />
          <Text style={{ ...text, fontSize: 12 }}>You set this reminder in Taskeeper.</Text>
        </Container>
      </Body>
    </Html>
  );
}

export function DigestEmail({ data, workspaceName, url }: { data: DigestData; workspaceName: string; url: string }) {
  const more = data.dueToday + data.overdue - data.tasks.length;
  return (
    <Html>
      <Head />
      <Preview>{`${digestSummary(data)} in ${workspaceName}`}</Preview>
      <Body style={body}>
        <Container style={card}>
          <Heading style={heading}>{digestSummary(data)}</Heading>
          <Text style={text}>Your tasks in {workspaceName}.</Text>
          <Section style={{ margin: '12px 0' }}>
            {data.tasks.map((t) => (
              <Text key={t.id} style={{ ...text, color: c.foreground }}>
                {t.title} <span style={{ color: c.muted }}>· {dateLabel(t.dueDate)}</span>
              </Text>
            ))}
            {more > 0 && <Text style={text}>and {more} more</Text>}
          </Section>
          <Button href={url} style={button}>View my calendar</Button>
          <Hr style={{ borderColor: c.border, margin: '24px 0 12px' }} />
          <Text style={{ ...text, fontSize: 12 }}>Turn the daily digest off in Account → Preferences.</Text>
        </Container>
      </Body>
    </Html>
  );
}
