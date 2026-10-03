import { UserTimezoneForm } from '@/components/settings/UserTimezoneForm';
import { requireUser } from '@/lib/session';
import { getUserTimezone } from '@/server/user-settings/service';

// A static segment, so it wins over settings/[path] (which only knows auth views).
export default async function PreferencesPage() {
  const timezone = await getUserTimezone(await requireUser());

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-label-lg text-text-strong-950">Preferences</h2>
        <p className="mt-1 text-paragraph-sm text-text-sub-600">How Taskeeper shows things to you.</p>
      </div>
      <UserTimezoneForm current={timezone} />
    </div>
  );
}
