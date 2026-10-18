import { NebulaError, NetworkError } from '../errors';
import { User } from '../types';

export function parseAvatarFields(
  user: Record<string, unknown>
): Pick<User, 'avatar_url' | 'avatar_source' | 'onboarding_completed'> {
  const value = user.avatar_url;
  if (value !== undefined) {
    let safe =
      typeof value === 'string' &&
      (value === '' ||
        /^\/avatars\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value));
    if (!safe && typeof value === 'string' && value.length <= 2048) {
      try {
        const url = new URL(value);
        safe =
          url.protocol === 'https:' &&
          !url.username &&
          !url.password &&
          !url.port &&
          !url.hash &&
          (url.hostname === 'avatars.githubusercontent.com' ||
            (url.hostname === 'github.com' && url.pathname === '/images/error/octocat_happy.gif'));
      } catch {
        /* Reject untrusted image locations. */
      }
    }
    if (!safe) throw new NetworkError('The account returned an invalid avatar URL.');
  }
  if (
    user.avatar_source !== undefined &&
    !['', 'github', 'upload', 'none'].includes(user.avatar_source as string)
  )
    throw new NetworkError('The account returned an invalid avatar source.');
  if (user.onboarding_completed !== undefined && typeof user.onboarding_completed !== 'boolean')
    throw new NetworkError('The account returned invalid onboarding state.');
  return {
    ...(value !== undefined && { avatar_url: value as string }),
    ...(user.avatar_source !== undefined && {
      avatar_source: user.avatar_source as User['avatar_source'],
    }),
    ...(user.onboarding_completed !== undefined && {
      onboarding_completed: user.onboarding_completed as boolean,
    }),
  };
}

export function avatarForm(file: Blob): FormData {
  if (typeof Blob === 'undefined' || typeof FormData === 'undefined')
    throw new NebulaError('Avatar upload requires native Blob and FormData support.');
  if (!(file instanceof Blob) || file.size === 0 || file.size > 2 * 1024 * 1024)
    throw new NebulaError('Provide a nonempty photo Blob or File up to 2 MiB.');
  if (file.type && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new NebulaError('Use a JPEG, PNG or WebP photo.');
  const form = new FormData();
  form.append('avatar', file, 'avatar');
  return form;
}

export function confirmAvatarResult(profile: User, action: 'upload' | 'remove' | 'onboard'): User {
  if (
    profile.onboarding_completed !== true ||
    (action === 'upload' &&
      (profile.avatar_source !== 'upload' ||
        !/^\/avatars\/[0-9a-f-]{36}$/.test(profile.avatar_url || ''))) ||
    (action === 'remove' && (profile.avatar_url !== '' || profile.avatar_source !== 'none'))
  )
    throw new NetworkError('Unconfirmed profile update. Read the current profile before retrying.');
  return profile;
}
