#pragma once

#include "entities/Weapon.hpp"

#include <SFML/Audio/Sound.hpp>
#include <SFML/Audio/SoundBuffer.hpp>
#include <SFML/System/Vector2.hpp>

#include <array>
#include <cstddef>
#include <memory>
#include <vector>

namespace dof::loaders { class ConfigLoader; }

namespace dof::audio {

class SpatialAudio {
public:
    explicit SpatialAudio(const dof::loaders::ConfigLoader& config);

    void setListenerPosition(sf::Vector2f heroPosition);
    void cleanup();

    void playPortalOpen(sf::Vector2f position);
    void playPortalClose(sf::Vector2f position);
    void playHeroAttack(dof::entities::AttackType attackType, sf::Vector2f position);
    void playEnemyAttack(dof::entities::AttackType attackType, sf::Vector2f position);
    void playEnemyUnarmedDash(sf::Vector2f position);
    void playHeroDash(sf::Vector2f position);
    void playEnemyJump(sf::Vector2f position);
    void playEnemyDeath(sf::Vector2f position);
    void playHeroDeath(sf::Vector2f position);

private:
    enum class SoundId : std::size_t {
        PortalOpen,
        PortalClose,
        HeroAttackSingle,
        HeroAttackSwipe,
        HeroAttackMultiTarget,
        HeroAttackMultiSingle,
        HeroAttackAoe,
        EnemyAttackSingle,
        EnemyAttackSwipe,
        EnemyAttackMultiTarget,
        EnemyAttackMultiSingle,
        EnemyAttackAoe,
        EnemyUnarmedDash,
        HeroDash,
        EnemyJump,
        EnemyDeath,
        HeroDeath,
        Count
    };

    static constexpr std::size_t soundCount = static_cast<std::size_t>(SoundId::Count);

    void loadSound(const dof::loaders::ConfigLoader& config,
                   SoundId soundId,
                   const char* pathKey,
                   const char* volumeKey);
    void play(SoundId soundId, sf::Vector2f position);
    SoundId heroAttackSound(dof::entities::AttackType attackType) const;
    SoundId enemyAttackSound(dof::entities::AttackType attackType) const;

    std::array<sf::SoundBuffer, soundCount> buffers;
    std::array<float, soundCount>           volumes{};
    std::array<bool, soundCount>            isLoaded{};
    std::vector<std::unique_ptr<sf::Sound>> activeSounds;
    float minDistance{260.0f};
    float maxDistance{2400.0f};
    float attenuation{1.0f};
    float minGain{0.0f};
    int   maxActiveSounds{96};
};

} // namespace dof::audio
