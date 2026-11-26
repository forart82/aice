module Jobs
  class Runner
    def initialize(name)
      @name = name
    end

    def execute(payload)
      "#{@name}:#{payload}"
    end
  end
end
