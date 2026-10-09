#include <SFML/Graphics.hpp>
#include "_GLOBALS.h"
#include "Snake.h"

class ScoreBoard
{

private:
  sf::Font m_font;
  sf::Text m_speedText;
  sf::Text m_scoreText;
  sf::Text m_sizeText;

  bool m_isFontLoaded;

public:
  ScoreBoard();
  ~ScoreBoard();

  void update(Snake *snake);
  void draw(sf::RenderTarget &target);
};