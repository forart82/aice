#include "audio/SpatialAudio.hpp"

#include "loaders/ConfigLoader.hpp"

#include <SFML/Audio/Listener.hpp>
#include <SFML/Audio/SoundSource.hpp>

#include <algorithm>
#include <stdexcept>
#include <string>

namespace dof::audio {

SpatialAudio::SpatialAudio(const dof::loaders::ConfigLoader& config) {
    minDistance = std::max(1.0f, config.getFloat("SPATIAL_SOUND_MIN_DISTANCE"));
    maxDistance = std::max(minDistance, config.getFloat("SPATIAL_SOUND_MAX_DISTANCE"));
    attenuation = std::max(0.0f, config.getFloat("SPATIAL_SOUND_ATTENUATION"));
    minGain = std::clamp(config.getFloat("SPATIAL_SOUND_MIN_GAIN"), 0.0f, 1.0f);
    maxActiveSounds = std::max(1, config.getInt("SPATIAL_SOUND_MAX_ACTIVE"));

    loadSound(config, SoundId::PortalOpen, "SFX_PORTAL_OPEN_PATH", "SFX_PORTAL_OPEN_VOLUME");
    loadSound(config, SoundId::PortalClose, "SFX_PORTAL_CLOSE_PATH", "SFX_PORTAL_CLOSE_VOLUME");
    loadSound(config, SoundId::HeroAttackSingle,
              "SFX_HERO_ATTACK_SINGLE_PATH", "SFX_HERO_ATTACK_SINGLE_VOLUME");
    loadSound(config, SoundId::HeroAttackSwipe,
              "SFX_HERO_ATTACK_SWIPE_PATH", "SFX_HERO_ATTACK_SWIPE_VOLUME");
    loadSound(config, SoundId::HeroAttackMultiTarget,
              "SFX_HERO_ATTACK_MULTITARGET_PATH", "SFX_HERO_ATTACK_MULTITARGET_VOLUME");
    loadSound(config, SoundId::HeroAttackMultiSingle,
              "SFX_HERO_ATTACK_MULTISINGLE_PATH", "SFX_HERO_ATTACK_MULTISINGLE_VOLUME");
    loadSound(config, SoundId::HeroAttackAoe,
              "SFX_HERO_ATTACK_AOE_PATH", "SFX_HERO_ATTACK_AOE_VOLUME");
    loadSound(config, SoundId::EnemyAttackSingle,
              "SFX_ENEMY_ATTACK_SINGLE_PATH", "SFX_ENEMY_ATTACK_SINGLE_VOLUME");
    loadSound(config, SoundId::EnemyAttackSwipe,
              "SFX_ENEMY_ATTACK_SWIPE_PATH", "SFX_ENEMY_ATTACK_SWIPE_VOLUME");
    loadSound(config, SoundId::EnemyAttackMultiTarget,
              "SFX_ENEMY_ATTACK_MULTITARGET_PATH", "SFX_ENEMY_ATTACK_MULTITARGET_VOLUME");
    loadSound(config, SoundId::EnemyAttackMultiSingle,
              "SFX_ENEMY_ATTACK_MULTISINGLE_PATH", "SFX_ENEMY_ATTACK_MULTISINGLE_VOLUME");
    loadSound(config, SoundId::EnemyAttackAoe,
              "SFX_ENEMY_ATTACK_AOE_PATH", "SFX_ENEMY_ATTACK_AOE_VOLUME");
    loadSound(config, SoundId::EnemyUnarmedDash,
              "SFX_ENEMY_UNARMED_DASH_PATH", "SFX_ENEMY_UNARMED_DASH_VOLUME");
    loadSound(config, SoundId::HeroDash, "SFX_HERO_DASH_PATH", "SFX_HERO_DASH_VOLUME");
    loadSound(config, SoundId::EnemyJump, "SFX_ENEMY_JUMP_PATH", "SFX_ENEMY_JUMP_VOLUME");
    loadSound(config, SoundId::EnemyDeath, "SFX_ENEMY_DEATH_PATH", "SFX_ENEMY_DEATH_VOLUME");
    loadSound(config, SoundId::HeroDeath, "SFX_HERO_DEATH_PATH", "SFX_HERO_DEATH_VOLUME");

    sf::Listener::setDirection({0.0f, 0.0f, -1.0f});
    sf::Listener::setUpVector({0.0f, 1.0f, 0.0f});
}

void SpatialAudio::loadSound(const dof::loaders::ConfigLoader& config,
                             SoundId soundId,
                             const char* pathKey,
                             const char* volumeKey) {
    const auto index = static_cast<std::size_t>(soundId);
    const std::string path = config.getString(pathKey);
    if (!buffers[index].loadFromFile(path)) {
        throw std::runtime_error("SpatialAudio: failed to load sound: " + path);
    }
    volumes[index] = std::clamp(config.getFloat(volumeKey), 0.0f, 100.0f);
    isLoaded[index] = true;
}

void SpatialAudio::setListenerPosition(sf::Vector2f heroPosition) {
    sf::Listener::setPosition({heroPosition.x, 0.0f, heroPosition.y});
}

void SpatialAudio::cleanup() {
    std::erase_if(activeSounds, [](const auto& sound) {
        return !sound || sound->getStatus() == sf::SoundSource::Status::Stopped;
    });
}

void SpatialAudio::play(SoundId soundId, sf::Vector2f position) {
    const auto index = static_cast<std::size_t>(soundId);
    if (!isLoaded[index]) return;

    cleanup();
    while (static_cast<int>(activeSounds.size()) >= maxActiveSounds && !activeSounds.empty()) {
        activeSounds.erase(activeSounds.begin());
    }

    auto sound = std::make_unique<sf::Sound>(buffers[index]);
    sound->setVolume(volumes[index]);
    sound->setSpatializationEnabled(true);
    sound->setRelativeToListener(false);
    sound->setPosition({position.x, 0.0f, position.y});
    sound->setMinDistance(minDistance);
    sound->setMaxDistance(maxDistance);
    sound->setMinGain(minGain);
    sound->setAttenuation(attenuation);
    sound->play();
    activeSounds.push_back(std::move(sound));
}

SpatialAudio::SoundId SpatialAudio::heroAttackSound(dof::entities::AttackType attackType) const {
    switch (attackType) {
        case dof::entities::AttackType::Single:      return SoundId::HeroAttackSingle;
        case dof::entities::AttackType::Swipe:       return SoundId::HeroAttackSwipe;
        case dof::entities::AttackType::MultiTarget: return SoundId::HeroAttackMultiTarget;
        case dof::entities::AttackType::MultiSingle: return SoundId::HeroAttackMultiSingle;
        case dof::entities::AttackType::Aoe:         return SoundId::HeroAttackAoe;
    }
    return SoundId::HeroAttackSingle;
}

SpatialAudio::SoundId SpatialAudio::enemyAttackSound(dof::entities::AttackType attackType) const {
    switch (attackType) {
        case dof::entities::AttackType::Single:      return SoundId::EnemyAttackSingle;
        case dof::entities::AttackType::Swipe:       return SoundId::EnemyAttackSwipe;
        case dof::entities::AttackType::MultiTarget: return SoundId::EnemyAttackMultiTarget;
        case dof::entities::AttackType::MultiSingle: return SoundId::EnemyAttackMultiSingle;
        case dof::entities::AttackType::Aoe:         return SoundId::EnemyAttackAoe;
    }
    return SoundId::EnemyAttackSingle;
}

void SpatialAudio::playPortalOpen(sf::Vector2f position) {
    play(SoundId::PortalOpen, position);
}

void SpatialAudio::playPortalClose(sf::Vector2f position) {
    play(SoundId::PortalClose, position);
}

void SpatialAudio::playHeroAttack(dof::entities::AttackType attackType, sf::Vector2f position) {
    play(heroAttackSound(attackType), position);
}

void SpatialAudio::playEnemyAttack(dof::entities::AttackType attackType, sf::Vector2f position) {
    play(enemyAttackSound(attackType), position);
}

void SpatialAudio::playEnemyUnarmedDash(sf::Vector2f position) {
    play(SoundId::EnemyUnarmedDash, position);
}

void SpatialAudio::playHeroDash(sf::Vector2f position) {
    play(SoundId::HeroDash, position);
}

void SpatialAudio::playEnemyJump(sf::Vector2f position) {
    play(SoundId::EnemyJump, position);
}

void SpatialAudio::playEnemyDeath(sf::Vector2f position) {
    play(SoundId::EnemyDeath, position);
}

void SpatialAudio::playHeroDeath(sf::Vector2f position) {
    play(SoundId::HeroDeath, position);
}

} // namespace dof::audio
