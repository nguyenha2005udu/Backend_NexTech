// Chép nguyên từ be/src/users/auth/oauth.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import {
  Strategy as GoogleStrategyBase,
  Profile as GoogleProfile,
} from 'passport-google-oauth20';
import {
  Strategy as FacebookStrategyBase,
  Profile as FacebookProfile,
} from 'passport-facebook';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleStrategy extends PassportStrategy(
  GoogleStrategyBase,
  'google',
) {
  constructor(config: ConfigService) {
    super({
      clientID: config.get<string>('google.clientId') as string,
      clientSecret: config.get<string>('google.clientSecret') as string,
      callbackURL: config.get<string>('google.callbackUrl') as string,
      scope: ['email', 'profile'],
    });
  }

  validate(accessToken: string, refreshToken: string, profile: GoogleProfile) {
    return {
      provider: 'google',
      provider_id: profile.id,
      email: profile.emails?.[0]?.value,
      full_name: profile.displayName,
      avatar_url: profile.photos?.[0]?.value,
    };
  }
}

@Injectable()
export class FacebookStrategy extends PassportStrategy(
  FacebookStrategyBase,
  'facebook',
) {
  constructor(config: ConfigService) {
    super({
      clientID: config.get<string>('facebook.appId') as string,
      clientSecret: config.get<string>('facebook.appSecret') as string,
      callbackURL: config.get<string>('facebook.callbackUrl') as string,
      profileFields: ['id', 'emails', 'name', 'photos'],
    });
  }

  validate(
    accessToken: string,
    refreshToken: string,
    profile: FacebookProfile,
  ) {
    return {
      provider: 'facebook',
      provider_id: profile.id,
      email: profile.emails?.[0]?.value,
      full_name:
        `${profile.name?.givenName || ''} ${profile.name?.familyName || ''}`.trim(),
      avatar_url: profile.photos?.[0]?.value,
    };
  }
}
