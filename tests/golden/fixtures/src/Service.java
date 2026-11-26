package com.aice.golden;

public class Service {
    private final String name;

    public Service(String name) {
        this.name = name;
    }

    public String greet(String user) {
        return this.name + ":" + user;
    }
}
